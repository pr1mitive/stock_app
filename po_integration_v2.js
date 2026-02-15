/**
 * 発注管理連携スクリプト v2.0 (PO Integration Script)
 * 作成日: 2026-02-15
 * 
 * 【機能概要】
 * 発注明細テーブル（po_items）対応版
 * 在庫取引（入庫）と発注管理アプリを連携し、発注明細ごとの発注残を自動管理
 * 
 * 【処理仕様】
 * 1. 在庫取引で入庫（確定）が作成/更新されたら発注管理アプリを更新
 * 2. 発注番号 + 品目コードに紐づく入庫数を集計
 * 3. 発注明細テーブルの該当明細行を更新（納品済数・発注残数・納品ステータス）
 * 4. 過納品（発注数を超える納品）の場合はエラーで入庫を拒否
 * 
 * 【必須ファイル】
 * - inventory_config_v2.0.4.js
 * - inventory_utils.js
 */

(() => {
  'use strict';

  // 依存ファイルの確認
  if (typeof window.INVENTORY_CONFIG === 'undefined') {
    console.error('[PO] inventory_config.js が読み込まれていません');
    return;
  }
  if (typeof window.InventoryUtils === 'undefined') {
    console.error('[PO] inventory_utils.js が読み込まれていません');
    return;
  }

  const CONFIG = window.INVENTORY_CONFIG;
  const UTILS = window.InventoryUtils;
  const APP_IDS = CONFIG.APP_IDS;
  const FIELDS = CONFIG.FIELDS;

  /**
   * 発注管理レコードを取得
   */
  async function getPORecord(poNumber) {
    if (!poNumber) return null;

    try {
      const query = `${FIELDS.PO.PO_NUMBER} = "${poNumber}"`;
      UTILS.log(`発注管理レコード取得クエリ: ${query}`);

      const resp = await kintone.api(
        kintone.api.url('/k/v1/records', true),
        'GET',
        {
          app: APP_IDS.PO_MANAGEMENT,
          query: query
        }
      );

      if (resp.records && resp.records.length > 0) {
        UTILS.log(`発注管理レコード取得成功: ${poNumber}`);
        return resp.records[0];
      }

      UTILS.warn(`発注管理レコードが見つかりません: ${poNumber}`);
      return null;

    } catch (error) {
      UTILS.error('発注管理レコード取得エラー:', error);
      throw error;
    }
  }

  /**
   * 発注明細テーブルから該当品目の明細行を取得
   */
  function getPOItemRow(poRecord, itemCode) {
    if (!poRecord || !itemCode) return null;

    const poItemsField = FIELDS.PO.PO_ITEMS;
    const poItems = poRecord[poItemsField]?.value || [];

    if (poItems.length === 0) {
      UTILS.warn('発注明細テーブルが空です');
      return null;
    }

    // 品目コードで検索
    const itemRow = poItems.find(row => {
      const rowItemCode = row.value[FIELDS.PO_ITEM.ITEM_CODE]?.value || '';
      return rowItemCode === itemCode;
    });

    if (!itemRow) {
      UTILS.warn(`発注明細に品目 ${itemCode} が見つかりません`);
      return null;
    }

    // 行のインデックスを追加
    const rowIndex = poItems.indexOf(itemRow);
    return {
      ...itemRow,
      rowIndex: rowIndex
    };
  }

  /**
   * 発注番号 + 品目コードに紐づく入庫済数量を集計
   */
  async function calculateReceivedQty(poNumber, itemCode) {
    try {
      // 在庫取引アプリから発注番号 + 品目コードに紐づく入庫（確定）レコードを取得
      const query = `${FIELDS.TRANSACTION.PO_NUMBER} = "${poNumber}" and ${FIELDS.TRANSACTION.ITEM_CODE} = "${itemCode}" and ${FIELDS.TRANSACTION.TRANSACTION_TYPE} = "入庫" and ${FIELDS.TRANSACTION.STATUS} = "確定"`;
      
      UTILS.log(`入庫集計クエリ: ${query}`);

      const resp = await kintone.api(
        kintone.api.url('/k/v1/records', true),
        'GET',
        {
          app: APP_IDS.INVENTORY_TRANSACTION,
          query: query
        }
      );

      let totalReceivedQty = 0;
      let lastReceivedDate = null;

      if (resp.records && resp.records.length > 0) {
        resp.records.forEach(record => {
          const qty = UTILS.getNumberValue(record, FIELDS.TRANSACTION.QUANTITY);
          const date = UTILS.getFieldValue(record, FIELDS.TRANSACTION.TRANSACTION_DATE);
          
          totalReceivedQty += qty;
          
          // 最終納品日を更新
          if (!lastReceivedDate || (date && date > lastReceivedDate)) {
            lastReceivedDate = date;
          }
        });
      }

      UTILS.log(`${poNumber}-${itemCode} 納品済数: ${totalReceivedQty}, 最終納品日: ${lastReceivedDate}`);

      return {
        receivedQty: totalReceivedQty,
        lastReceivedDate: lastReceivedDate,
        recordCount: resp.records ? resp.records.length : 0
      };

    } catch (error) {
      UTILS.error('入庫集計エラー:', error);
      throw error;
    }
  }

  /**
   * 納品ステータスを判定
   */
  function determineDeliveryStatus(orderedQty, receivedQty) {
    if (receivedQty === 0) {
      return CONFIG.DELIVERY_STATUSES.NOT_DELIVERED; // 未納品
    } else if (receivedQty < orderedQty) {
      return CONFIG.DELIVERY_STATUSES.PARTIAL; // 一部納品
    } else if (receivedQty === orderedQty) {
      return CONFIG.DELIVERY_STATUSES.COMPLETED; // 完納
    } else {
      return CONFIG.DELIVERY_STATUSES.OVER_DELIVERED; // 過納品
    }
  }

  /**
   * 発注明細テーブルの該当行を更新
   */
  async function updatePOItemRow(poRecord, itemCode, receivedQty, lastReceivedDate) {
    try {
      // 発注明細テーブルから該当行を取得
      const itemRow = getPOItemRow(poRecord, itemCode);
      
      if (!itemRow) {
        UTILS.warn(`発注明細に品目 ${itemCode} が見つかりません`);
        return;
      }

      const orderedQty = parseFloat(itemRow.value[FIELDS.PO_ITEM.QUANTITY]?.value || 0);
      const remainingQty = orderedQty - receivedQty;
      const deliveryStatus = determineDeliveryStatus(orderedQty, receivedQty);

      UTILS.log(`発注明細更新: ${itemCode} - 発注数=${orderedQty}, 納品済数=${receivedQty}, 発注残数=${remainingQty}, ステータス=${deliveryStatus}`);

      // 発注明細テーブル全体を取得
      const poItemsField = FIELDS.PO.PO_ITEMS;
      const poItems = poRecord[poItemsField]?.value || [];

      // 該当行を更新
      if (itemRow.rowIndex >= 0 && itemRow.rowIndex < poItems.length) {
        poItems[itemRow.rowIndex].value[FIELDS.PO_ITEM.RECEIVED_QTY] = { value: receivedQty };
        poItems[itemRow.rowIndex].value[FIELDS.PO_ITEM.REMAINING_QTY] = { value: remainingQty };
        poItems[itemRow.rowIndex].value[FIELDS.PO_ITEM.DELIVERY_STATUS] = { value: deliveryStatus };
      }

      // 発注管理レコードを更新
      const updateData = {
        app: APP_IDS.PO_MANAGEMENT,
        id: poRecord.$id.value,
        record: {
          [poItemsField]: { value: poItems }
        }
      };

      // 最終納品日を更新（ヘッダー）
      if (lastReceivedDate && FIELDS.PO.LAST_RECEIVED_DATE) {
        updateData.record[FIELDS.PO.LAST_RECEIVED_DATE] = { value: lastReceivedDate };
      }

      await kintone.api(
        kintone.api.url('/k/v1/record', true),
        'PUT',
        updateData
      );

      UTILS.log(`✅ 発注明細更新完了: ${UTILS.getFieldValue(poRecord, FIELDS.PO.PO_NUMBER)} - ${itemCode}`);

      return deliveryStatus;

    } catch (error) {
      UTILS.error('発注明細更新エラー:', error);
      throw error;
    }
  }

  /**
   * 過納品チェック（入庫前バリデーション）
   */
  async function validateReceiving(poNumber, itemCode, receivingQty) {
    if (!poNumber) {
      // 発注番号が指定されていない場合はチェックしない
      return { valid: true };
    }

    try {
      // 発注管理レコードを取得
      const poRecord = await getPORecord(poNumber);
      
      if (!poRecord) {
        return { 
          valid: false, 
          message: `発注番号「${poNumber}」が見つかりません。\n発注管理アプリで発注番号を確認してください。`
        };
      }

      // 発注明細から該当品目を取得
      const itemRow = getPOItemRow(poRecord, itemCode);
      
      if (!itemRow) {
        return { 
          valid: false, 
          message: `発注番号「${poNumber}」に品目「${itemCode}」の明細が見つかりません。\n発注管理アプリで発注明細を確認してください。`
        };
      }

      // 発注数を取得
      const orderedQty = parseFloat(itemRow.value[FIELDS.PO_ITEM.QUANTITY]?.value || 0);
      
      if (orderedQty === 0) {
        return { 
          valid: false, 
          message: `発注番号「${poNumber}」の品目「${itemCode}」の発注数が0です。\n発注管理アプリで発注数を確認してください。`
        };
      }

      // 既存の納品済数を取得
      const { receivedQty } = await calculateReceivedQty(poNumber, itemCode);

      // 今回の入庫後の納品済数
      const newReceivedQty = receivedQty + receivingQty;

      UTILS.log(`過納品チェック: ${itemCode} - 発注数=${orderedQty}, 既存納品済数=${receivedQty}, 今回入庫数=${receivingQty}, 合計=${newReceivedQty}`);

      // 過納品チェック
      if (newReceivedQty > orderedQty) {
        const overQty = newReceivedQty - orderedQty;
        return { 
          valid: false, 
          message: `⚠️ 過納品エラー\n\n` +
                   `発注番号: ${poNumber}\n` +
                   `品目コード: ${itemCode}\n` +
                   `発注数: ${orderedQty}\n` +
                   `既存納品済数: ${receivedQty}\n` +
                   `今回入庫数: ${receivingQty}\n` +
                   `合計納品数: ${newReceivedQty}\n\n` +
                   `過納品数: ${overQty}\n\n` +
                   `発注数を超える納品はできません。\n` +
                   `入庫数を ${orderedQty - receivedQty} 以下に変更してください。`
        };
      }

      return { 
        valid: true,
        poRecord: poRecord,
        itemRow: itemRow,
        orderedQty: orderedQty,
        currentReceivedQty: receivedQty,
        newReceivedQty: newReceivedQty
      };

    } catch (error) {
      UTILS.error('過納品チェックエラー:', error);
      return { 
        valid: false, 
        message: `発注管理アプリとの連携でエラーが発生しました:\n${error.message}`
      };
    }
  }

  /**
   * 発注管理連携メイン処理
   */
  async function integratePOManagement(transactionRecord) {
    const poNumber = UTILS.getFieldValue(transactionRecord, FIELDS.TRANSACTION.PO_NUMBER);
    const transactionType = UTILS.getFieldValue(transactionRecord, FIELDS.TRANSACTION.TRANSACTION_TYPE);
    const status = UTILS.getFieldValue(transactionRecord, FIELDS.TRANSACTION.STATUS);
    const itemCode = UTILS.getFieldValue(transactionRecord, FIELDS.TRANSACTION.ITEM_CODE);

    // 入庫かつ確定の場合のみ処理
    if (transactionType !== '入庫' || status !== '確定') {
      UTILS.log('発注管理連携: 入庫確定以外のためスキップ');
      return;
    }

    // 発注番号が指定されていない場合はスキップ
    if (!poNumber) {
      UTILS.log('発注管理連携: 発注番号未指定のためスキップ');
      return;
    }

    UTILS.log(`=== 発注管理連携開始: ${poNumber} - ${itemCode} ===`);

    try {
      // 発注管理レコードを取得
      const poRecord = await getPORecord(poNumber);
      
      if (!poRecord) {
        UTILS.warn(`発注番号 ${poNumber} が見つかりません`);
        return;
      }

      // 納品済数を集計
      const { receivedQty, lastReceivedDate } = await calculateReceivedQty(poNumber, itemCode);

      // 発注明細テーブルの該当行を更新
      await updatePOItemRow(poRecord, itemCode, receivedQty, lastReceivedDate);

      UTILS.log(`=== 発注管理連携完了: ${poNumber} - ${itemCode} ===`);

    } catch (error) {
      UTILS.error('発注管理連携エラー:', error);
      // エラーが出ても在庫更新は完了しているので、エラーを投げない
      UTILS.warn('発注管理連携でエラーが発生しましたが、在庫更新は完了しています');
    }
  }

  /**
   * 在庫取引アプリのイベント監視（保存前バリデーション）
   */
  kintone.events.on([
    'app.record.create.submit',
    'app.record.edit.submit'
  ], async function(event) {
    const record = event.record;
    const poNumber = UTILS.getFieldValue(record, FIELDS.TRANSACTION.PO_NUMBER);
    const transactionType = UTILS.getFieldValue(record, FIELDS.TRANSACTION.TRANSACTION_TYPE);
    const status = UTILS.getFieldValue(record, FIELDS.TRANSACTION.STATUS);
    const itemCode = UTILS.getFieldValue(record, FIELDS.TRANSACTION.ITEM_CODE);
    const quantity = UTILS.getNumberValue(record, FIELDS.TRANSACTION.QUANTITY);

    // 入庫かつ確定かつ発注番号ありの場合のみチェック
    if (transactionType === '入庫' && status === '確定' && poNumber) {
      UTILS.log('過納品チェック開始...');

      const validation = await validateReceiving(poNumber, itemCode, quantity);

      if (!validation.valid) {
        event.error = validation.message;
        UTILS.error('入庫拒否:', validation.message);
        return event;
      }

      UTILS.log('✅ 過納品チェックOK');
    }

    return event;
  });

  /**
   * 在庫取引アプリのイベント監視（保存後処理）
   */
  kintone.events.on([
    'app.record.create.submit.success',
    'app.record.edit.submit.success'
  ], async function(event) {
    const record = event.record;

    try {
      await integratePOManagement(record);
    } catch (error) {
      UTILS.error('発注管理連携でエラーが発生しました:', error);
      // エラーは表示するが、レコード保存自体は成功している
    }

    return event;
  });

  // グローバルに公開
  window.POIntegration = {
    VERSION: '2.0',
    getPORecord: getPORecord,
    getPOItemRow: getPOItemRow,
    calculateReceivedQty: calculateReceivedQty,
    updatePOItemRow: updatePOItemRow,
    validateReceiving: validateReceiving,
    integratePOManagement: integratePOManagement
  };

  UTILS.log('[PO] PO Integration Script loaded - Version: 2.0 (発注明細テーブル対応)');

})();
