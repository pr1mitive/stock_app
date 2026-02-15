/**
 * 在庫残高更新スクリプト
 * Version: 2.0
 * 在庫取引が「確定」になったときに在庫残高を更新
 */

(function() {
  'use strict';

  const CONFIG = window.INVENTORY_CONFIG;
  const Utils = window.InventoryUtils;

  if (!CONFIG || !Utils) {
    console.error('[INVENTORY] 依存ファイルが読み込まれていません');
    return;
  }

  console.log('[INVENTORY] Update Script loaded - Version: 2.0');

  /**
   * 在庫残高レコードを取得または作成
   */
  async function getOrCreateBalanceRecord(itemCode, warehouse, location) {
    const balanceId = `BAL-${itemCode}-${warehouse}-${location}`;
    
    try {
      // 既存レコードを検索
      const query = `balance_id = "${balanceId}"`;
      const resp = await kintone.api(
        kintone.api.url('/k/v1/records', true),
        'GET',
        {
          app: CONFIG.APP_IDS.INVENTORY_BALANCE,
          query: query
        }
      );

      if (resp.records && resp.records.length > 0) {
        Utils.log(`既存の在庫残高レコードを取得: ${balanceId}`);
        return resp.records[0];
      }

      // 新規レコードを作成
      Utils.log(`新規在庫残高レコードを作成: ${balanceId}`);
      
      // アイテムマスタから情報取得
      const itemResp = await kintone.api(
        kintone.api.url('/k/v1/records', true),
        'GET',
        {
          app: CONFIG.APP_IDS.ITEM_MASTER,
          query: `item_code = "${itemCode}"`
        }
      );

      const itemRecord = itemResp.records && itemResp.records.length > 0 
        ? itemResp.records[0] 
        : null;

      const newRecord = {
        app: CONFIG.APP_IDS.INVENTORY_BALANCE,
        record: {
          balance_id: { value: balanceId },
          item_code: { value: itemCode },
          item_name: { value: itemRecord ? itemRecord.item_name.value : '' },
          warehouse: { value: warehouse },
          location: { value: location },
          current_qty: { value: 0 },
          unit: { value: itemRecord ? itemRecord.unit.value : '' },
          safety_stock: { value: itemRecord ? itemRecord.safety_stock.value : 0 },
          average_cost: { value: 0 },
          alert_flag: { value: CONFIG.ALERT_FLAGS.OUT_OF_STOCK },
          last_transaction_date: { value: Utils.getToday() }
        }
      };

      const createResp = await kintone.api(
        kintone.api.url('/k/v1/record', true),
        'POST',
        newRecord
      );

      // 作成したレコードを取得して返す
      const getResp = await kintone.api(
        kintone.api.url('/k/v1/record', true),
        'GET',
        {
          app: CONFIG.APP_IDS.INVENTORY_BALANCE,
          id: createResp.id
        }
      );

      return getResp.record;

    } catch (error) {
      Utils.error('在庫残高レコード取得エラー:', error);
      throw error;
    }
  }

  /**
   * 移動平均単価を計算
   */
  function calculateMovingAverageCost(currentQty, currentCost, addQty, addCost) {
    if (addQty <= 0) {
      return currentCost; // 出庫時は単価変更なし
    }

    const currentAmount = currentQty * currentCost;
    const addAmount = addQty * addCost;
    const newQty = currentQty + addQty;

    if (newQty <= 0) {
      return 0;
    }

    const newCost = (currentAmount + addAmount) / newQty;
    return Utils.roundDecimal(newCost, 2);
  }

  /**
   * アラートフラグを判定
   */
  function determineAlertFlag(currentQty, safetyStock) {
    if (currentQty <= 0) {
      return CONFIG.ALERT_FLAGS.OUT_OF_STOCK;
    } else if (currentQty < safetyStock) {
      return CONFIG.ALERT_FLAGS.LOW_STOCK;
    } else {
      return CONFIG.ALERT_FLAGS.NORMAL;
    }
  }

  /**
   * 在庫残高を更新
   */
  async function updateInventoryBalance(transactionRecord) {
    const itemCode = Utils.getFieldValue(transactionRecord, CONFIG.FIELDS.TRANSACTION.ITEM_CODE);
    const warehouse = Utils.getFieldValue(transactionRecord, CONFIG.FIELDS.TRANSACTION.WAREHOUSE);
    const location = Utils.getFieldValue(transactionRecord, CONFIG.FIELDS.TRANSACTION.LOCATION);
    const transactionType = Utils.getFieldValue(transactionRecord, CONFIG.FIELDS.TRANSACTION.TRANSACTION_TYPE);
    const quantity = Utils.getNumberValue(transactionRecord, CONFIG.FIELDS.TRANSACTION.QUANTITY);
    const unitCost = Utils.getNumberValue(transactionRecord, CONFIG.FIELDS.TRANSACTION.UNIT_COST);
    const transactionDate = Utils.getFieldValue(transactionRecord, CONFIG.FIELDS.TRANSACTION.TRANSACTION_DATE);

    if (!itemCode || !warehouse || !location) {
      Utils.error('必須フィールドが不足しています:', { itemCode, warehouse, location });
      return;
    }

    Utils.log(`在庫更新開始: ${itemCode} - ${warehouse} - ${location}`);

    try {
      // 在庫残高レコードを取得または作成
      const balanceRecord = await getOrCreateBalanceRecord(itemCode, warehouse, location);
      const currentQty = Utils.getNumberValue(balanceRecord, CONFIG.FIELDS.BALANCE.CURRENT_QTY);
      const currentCost = Utils.getNumberValue(balanceRecord, CONFIG.FIELDS.BALANCE.AVERAGE_COST);
      const safetyStock = Utils.getNumberValue(balanceRecord, CONFIG.FIELDS.BALANCE.SAFETY_STOCK);

      let newQty = currentQty;
      let newCost = currentCost;

      // 取引区分に応じて在庫数を計算
      switch (transactionType) {
        case CONFIG.TRANSACTION_TYPES.RECEIVED:
          // 入庫
          newQty = currentQty + quantity;
          newCost = calculateMovingAverageCost(currentQty, currentCost, quantity, unitCost);
          Utils.log(`入庫処理: ${currentQty} + ${quantity} = ${newQty}, 平均単価: ${newCost}`);
          break;

        case CONFIG.TRANSACTION_TYPES.ISSUED:
          // 出庫
          newQty = currentQty - quantity;
          if (newQty < 0) {
            Utils.warn(`⚠️ 在庫がマイナスになります: ${itemCode} (${newQty})`);
          }
          Utils.log(`出庫処理: ${currentQty} - ${quantity} = ${newQty}`);
          break;

        case CONFIG.TRANSACTION_TYPES.ADJUSTMENT:
          // 棚卸調整
          const physicalCount = Utils.getNumberValue(transactionRecord, CONFIG.FIELDS.TRANSACTION.PHYSICAL_COUNT);
          newQty = physicalCount;
          Utils.log(`棚卸調整: ${currentQty} → ${newQty}`);
          break;

        case CONFIG.TRANSACTION_TYPES.INITIAL:
          // 初期在庫
          newQty = quantity;
          newCost = unitCost;
          Utils.log(`初期在庫設定: ${newQty}, 単価: ${newCost}`);
          break;

        default:
          Utils.error('不明な取引区分:', transactionType);
          return;
      }

      // アラートフラグを判定
      const alertFlag = determineAlertFlag(newQty, safetyStock);

      // 在庫残高レコードを更新
      const updateData = {
        app: CONFIG.APP_IDS.INVENTORY_BALANCE,
        id: balanceRecord.$id.value,
        record: {
          current_qty: { value: newQty },
          average_cost: { value: newCost },
          alert_flag: { value: alertFlag },
          last_transaction_date: { value: transactionDate || Utils.getToday() }
        }
      };

      await kintone.api(
        kintone.api.url('/k/v1/record', true),
        'PUT',
        updateData
      );

      Utils.log(`✅ 在庫更新完了: ${itemCode} - 在庫数: ${newQty}, 平均単価: ${newCost}, 状態: ${alertFlag}`);

      // アラート表示
      if (alertFlag === CONFIG.ALERT_FLAGS.OUT_OF_STOCK) {
        Utils.showAlert('⚠️ 在庫切れが発生しました', 'error');
      } else if (alertFlag === CONFIG.ALERT_FLAGS.LOW_STOCK) {
        Utils.showAlert('⚠️ 在庫が安全在庫を下回りました', 'warning');
      }

    } catch (error) {
      Utils.error('在庫更新エラー:', error);
      Utils.showAlert('在庫更新に失敗しました: ' + error.message, 'error');
      throw error;
    }
  }

  /**
   * ステータス変更を検出
   */
  function isStatusChangedToConfirmed(event) {
    if (event.type === 'app.record.create.submit') {
      // 新規作成時
      const status = Utils.getFieldValue(event.record, CONFIG.FIELDS.TRANSACTION.STATUS);
      return status === CONFIG.STATUSES.CONFIRMED;
    }

    if (event.type === 'app.record.edit.submit') {
      // 編集時
      const oldStatus = event.record[CONFIG.FIELDS.TRANSACTION.STATUS].value;
      const newStatus = event.changes.record[CONFIG.FIELDS.TRANSACTION.STATUS] 
        ? event.changes.record[CONFIG.FIELDS.TRANSACTION.STATUS].value 
        : oldStatus;

      // 予定→確定、または確定のまま数量変更
      return newStatus === CONFIG.STATUSES.CONFIRMED;
    }

    return false;
  }

  /**
   * 在庫取引アプリのイベント監視（作成）
   */
  kintone.events.on([
    'app.record.create.submit.success'
  ], async function(event) {
    const record = event.record;
    const status = Utils.getFieldValue(record, CONFIG.FIELDS.TRANSACTION.STATUS);

    Utils.log('在庫取引作成完了:', { status });

    // ステータスが「確定」の場合のみ在庫更新
    if (status === CONFIG.STATUSES.CONFIRMED) {
      try {
        await updateInventoryBalance(record);
      } catch (error) {
        Utils.error('在庫更新処理でエラーが発生しました:', error);
      }
    }

    return event;
  });

  /**
   * 在庫取引アプリのイベント監視（編集）
   */
  kintone.events.on([
    'app.record.edit.submit.success'
  ], async function(event) {
    const record = event.record;
    const status = Utils.getFieldValue(record, CONFIG.FIELDS.TRANSACTION.STATUS);

    Utils.log('在庫取引編集完了:', { status });

    // ステータスが「確定」の場合のみ在庫更新
    if (status === CONFIG.STATUSES.CONFIRMED) {
      try {
        await updateInventoryBalance(record);
      } catch (error) {
        Utils.error('在庫更新処理でエラーが発生しました:', error);
      }
    }

    return event;
  });

  // グローバル公開
  window.InventoryUpdate = {
    updateInventoryBalance: updateInventoryBalance,
    getOrCreateBalanceRecord: getOrCreateBalanceRecord,
    calculateMovingAverageCost: calculateMovingAverageCost,
    determineAlertFlag: determineAlertFlag
  };

  console.log('[INVENTORY] ✅ Update Script initialized');

})();
