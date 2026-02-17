/**
 * 在庫取引一括更新スクリプト (Inventory Batch Update Script)
 * バージョン: 2.1
 * 作成日: 2026-02-17
 * 
 * 【機能概要】
 * CSVインポート後の在庫残高・在庫推移サマリー・発注残数を一括更新
 * 
 * 【処理仕様】
 * 1. 在庫取引アプリ(760)の未処理レコード(processed_flag=OFF)を取得
 * 2. 取引コード (transaction_id) が未設定のレコードに自動採番
 * 3. 品目・倉庫・ロケーション別にグループ化
 * 4. 各グループごとに在庫残高(761)と在庫推移サマリー(762)を更新
 * 5. 発注番号が存在するレコードは発注管理(748)の received_qty を更新
 * 6. 処理済みレコードの processed_flag を ON に更新
 * 7. 進捗状況をリアルタイム表示
 * 
 * 【必須ファイル】
 * - inventory_config_v2.0.1.js
 * - inventory_utils.js
 */

(() => {
  'use strict';

  // 依存ファイルの確認
  if (typeof window.INVENTORY_CONFIG === 'undefined') {
    console.error('[BATCH] inventory_config.js が読み込まれていません');
    return;
  }
  if (typeof window.InventoryUtils === 'undefined') {
    console.error('[BATCH] inventory_utils.js が読み込まれていません');
    return;
  }

  const CONFIG = window.INVENTORY_CONFIG;
  const UTILS = window.InventoryUtils;
  const APP_IDS = CONFIG.APP_IDS;
  const FIELDS = CONFIG.FIELDS.TRANSACTION;
  const PO_FIELDS = CONFIG.FIELDS.PO_MANAGEMENT;

  // 一括更新の設定
  const BATCH_CONFIG = {
    MAX_RECORDS: 500,        // 1回の取得上限
    BATCH_SIZE: 100,         // 1回の更新件数
    DELAY: 100,              // API呼び出し間隔(ms)
    RETRY_COUNT: 3,          // リトライ回数
    RETRY_DELAY: 1000        // リトライ間隔(ms)
  };

  /**
   * 一括更新メイン処理
   */
  async function batchUpdateInventory() {
    UTILS.log('=== 在庫一括更新開始 (v2.1) ===');
    
    try {
      // 1. 未処理レコード取得
      const unprocessedRecords = await getUnprocessedRecords();
      
      if (unprocessedRecords.length === 0) {
        UTILS.showAlert('未処理の取引レコードがありません', 'info');
        return { success: true, processedCount: 0 };
      }

      UTILS.log(`未処理レコード: ${unprocessedRecords.length}件`);
      
      // 2. 取引コード自動採番
      const recordsWithIds = await assignTransactionIds(unprocessedRecords);
      UTILS.log(`取引コード採番完了`);

      // 3. 品目・倉庫・ロケーション別にグループ化
      const groups = groupByItemWarehouseLocation(recordsWithIds);
      UTILS.log(`処理グループ数: ${Object.keys(groups).length}`);

      // 4. プログレスバー表示
      showProgressBar(0, Object.keys(groups).length);

      let processedCount = 0;
      let errorCount = 0;
      const errors = [];

      // 5. グループごとに処理
      for (const [key, records] of Object.entries(groups)) {
        try {
          UTILS.log(`処理中: ${key} (${records.length}件)`);
          
          // 在庫残高更新
          await updateBalanceForGroup(records);
          
          // 在庫推移サマリー更新
          await updateProjectionForGroup(records);
          
          // 発注残数更新 (発注番号が存在するレコードのみ)
          await updatePOReceivedQty(records);
          
          // 処理済みフラグ更新
          await markRecordsAsProcessed(records.map(r => r.$id.value));
          
          processedCount += records.length;
          
        } catch (error) {
          UTILS.error(`${key} の処理エラー:`, error);
          errorCount += records.length;
          errors.push({ key, error: error.message, recordIds: records.map(r => r.$id.value) });
        }

        // プログレスバー更新
        updateProgressBar(processedCount + errorCount, unprocessedRecords.length);
        
        // API制限対策の待機
        await UTILS.sleep(BATCH_CONFIG.DELAY);
      }

      // 6. 結果表示
      hideProgressBar();
      showResultSummary(processedCount, errorCount, errors);

      return {
        success: errorCount === 0,
        processedCount,
        errorCount,
        errors
      };

    } catch (error) {
      UTILS.error('一括更新エラー:', error);
      hideProgressBar();
      UTILS.showAlert(`エラーが発生しました: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 未処理レコード取得
   */
  async function getUnprocessedRecords() {
    const query = `${FIELDS.PROCESSED_FLAG} not in ("処理済み") order by ${FIELDS.TRANSACTION_DATE} asc limit ${BATCH_CONFIG.MAX_RECORDS}`;
    
    UTILS.log(`クエリ: ${query}`);
    
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
        app: APP_IDS.INVENTORY_TRANSACTION,
        query: query
      });
      
      return resp.records || [];
    } catch (error) {
      UTILS.error('未処理レコード取得エラー:', error);
      throw new Error('取引レコードの取得に失敗しました');
    }
  }

  /**
   * 取引コード自動採番
   * @param {Array} records - 処理対象レコード
   * @returns {Array} - transaction_id が設定されたレコード
   */
  async function assignTransactionIds(records) {
    const recordsToUpdate = [];
    
    for (const record of records) {
      const transactionId = UTILS.getFieldValue(record, FIELDS.TRANSACTION_ID);
      
      // transaction_id が未設定の場合のみ採番
      if (!transactionId) {
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
        const newId = `TXN-${dateStr}-${randomStr}`;
        
        recordsToUpdate.push({
          id: record.$id.value,
          record: {
            [FIELDS.TRANSACTION_ID]: { value: newId }
          }
        });
        
        // レコードオブジェクトも更新
        record[FIELDS.TRANSACTION_ID] = { value: newId };
      }
    }

    // 取引コードを一括更新
    if (recordsToUpdate.length > 0) {
      UTILS.log(`取引コード自動採番: ${recordsToUpdate.length}件`);
      
      for (let i = 0; i < recordsToUpdate.length; i += BATCH_CONFIG.BATCH_SIZE) {
        const batch = recordsToUpdate.slice(i, i + BATCH_CONFIG.BATCH_SIZE);
        
        await kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', {
          app: APP_IDS.INVENTORY_TRANSACTION,
          records: batch
        });
        
        await UTILS.sleep(BATCH_CONFIG.DELAY);
      }
    }

    return records;
  }

  /**
   * レコードを品目・倉庫・ロケーション別にグループ化
   */
  function groupByItemWarehouseLocation(records) {
    const groups = {};
    
    records.forEach(record => {
      const itemCode = UTILS.getFieldValue(record, FIELDS.ITEM_CODE);
      const warehouse = UTILS.getFieldValue(record, FIELDS.WAREHOUSE);
      const location = UTILS.getFieldValue(record, FIELDS.LOCATION);
      
      if (!itemCode || !warehouse || !location) {
        UTILS.warn('必須フィールドが不足しているレコードをスキップ:', record.$id.value);
        return;
      }

      const key = `${itemCode}-${warehouse}-${location}`;
      
      if (!groups[key]) {
        groups[key] = [];
      }
      
      groups[key].push(record);
    });
    
    return groups;
  }

  /**
   * グループの在庫残高を更新
   */
  async function updateBalanceForGroup(records) {
    if (records.length === 0) return;

    const firstRecord = records[0];
    const itemCode = UTILS.getFieldValue(firstRecord, FIELDS.ITEM_CODE);
    const warehouse = UTILS.getFieldValue(firstRecord, FIELDS.WAREHOUSE);
    const location = UTILS.getFieldValue(firstRecord, FIELDS.LOCATION);

    // 確定済みレコードのみを集計
    const confirmedRecords = records.filter(r => 
      UTILS.getFieldValue(r, FIELDS.STATUS) === '確定'
    );

    if (confirmedRecords.length === 0) {
      UTILS.log(`確定済みレコードなし: ${itemCode}-${warehouse}-${location}`);
      return;
    }

    // 在庫残高レコード取得
    const balanceId = `BAL-${itemCode}-${warehouse}-${location}`;
    let balanceRecord = await getBalanceRecord(balanceId);

    // 初期値設定
    let currentQty = balanceRecord ? 
      UTILS.getNumberValue(balanceRecord, CONFIG.FIELDS.BALANCE.CURRENT_QTY) : 0;
    let totalValue = balanceRecord ? 
      currentQty * UTILS.getNumberValue(balanceRecord, CONFIG.FIELDS.BALANCE.AVERAGE_COST) : 0;

    // 各取引を時系列順に処理
    for (const record of confirmedRecords) {
      const transactionType = UTILS.getFieldValue(record, FIELDS.TRANSACTION_TYPE);
      const quantity = UTILS.getNumberValue(record, FIELDS.QUANTITY);
      const unitCost = UTILS.getNumberValue(record, FIELDS.UNIT_COST);

      if (transactionType === '入庫') {
        // 移動平均単価計算
        totalValue += quantity * unitCost;
        currentQty += quantity;
      } else if (transactionType === '出庫') {
        currentQty -= quantity;
      } else if (transactionType === '棚卸') {
        const physicalCount = UTILS.getNumberValue(record, FIELDS.PHYSICAL_COUNT);
        currentQty = physicalCount;
      } else if (transactionType === '初期在庫') {
        currentQty = quantity;
        totalValue = quantity * unitCost;
      }
    }

    // 平均単価計算
    const averageCost = currentQty > 0 ? totalValue / currentQty : 0;

    // アラートフラグ判定
    const safetyStock = balanceRecord ? 
      UTILS.getNumberValue(balanceRecord, CONFIG.FIELDS.BALANCE.SAFETY_STOCK) : 0;
    const alertFlag = getAlertFlag(currentQty, safetyStock);

    // 在庫残高レコード更新または作成
    const balanceData = {
      [CONFIG.FIELDS.BALANCE.CURRENT_QTY]: { value: currentQty },
      [CONFIG.FIELDS.BALANCE.AVERAGE_COST]: { value: Math.round(averageCost * 100) / 100 },
      [CONFIG.FIELDS.BALANCE.INVENTORY_VALUE]: { value: Math.round(currentQty * averageCost) },
      [CONFIG.FIELDS.BALANCE.ALERT_FLAG]: { value: alertFlag },
      [CONFIG.FIELDS.BALANCE.LAST_TRANSACTION_DATE]: { 
        value: UTILS.getFieldValue(confirmedRecords[confirmedRecords.length - 1], FIELDS.TRANSACTION_DATE)
      }
    };

    if (balanceRecord) {
      // 更新
      await updateBalanceRecord(balanceRecord.$id.value, balanceData);
    } else {
      // 新規作成
      balanceData[CONFIG.FIELDS.BALANCE.BALANCE_ID] = { value: balanceId };
      balanceData[CONFIG.FIELDS.BALANCE.ITEM_CODE] = { value: itemCode };
      balanceData[CONFIG.FIELDS.BALANCE.WAREHOUSE] = { value: warehouse };
      balanceData[CONFIG.FIELDS.BALANCE.LOCATION] = { value: location };
      await createBalanceRecord(balanceData);
    }

    UTILS.log(`在庫残高更新完了: ${balanceId} - 数量:${currentQty}, 平均単価:${averageCost}`);
  }

  /**
   * グループの在庫推移サマリーを更新
   */
  async function updateProjectionForGroup(records) {
    if (records.length === 0) return;

    const firstRecord = records[0];
    const itemCode = UTILS.getFieldValue(firstRecord, FIELDS.ITEM_CODE);
    const warehouse = UTILS.getFieldValue(firstRecord, FIELDS.WAREHOUSE);
    const location = UTILS.getFieldValue(firstRecord, FIELDS.LOCATION);

    // 確定済みレコードのみを集計
    const confirmedRecords = records.filter(r => 
      UTILS.getFieldValue(r, FIELDS.STATUS) === '確定'
    );

    if (confirmedRecords.length === 0) {
      UTILS.log(`確定済みレコードなし(サマリー): ${itemCode}-${warehouse}-${location}`);
      return;
    }

    // 取引日ごとにグループ化
    const dailyTransactions = {};
    
    confirmedRecords.forEach(record => {
      const date = UTILS.getFieldValue(record, FIELDS.TRANSACTION_DATE);
      const transactionType = UTILS.getFieldValue(record, FIELDS.TRANSACTION_TYPE);
      const quantity = UTILS.getNumberValue(record, FIELDS.QUANTITY);
      
      if (!date) return;
      
      if (!dailyTransactions[date]) {
        dailyTransactions[date] = {
          receivedQty: 0,
          issuedQty: 0
        };
      }
      
      if (transactionType === '入庫' || transactionType === '初期在庫') {
        dailyTransactions[date].receivedQty += quantity;
      } else if (transactionType === '出庫') {
        dailyTransactions[date].issuedQty += quantity;
      }
    });

    // 各日付のサマリーレコードを更新
    for (const [date, quantities] of Object.entries(dailyTransactions)) {
      const summaryId = `SUM-${date}-${itemCode}-${warehouse}-${location}`;
      
      try {
        // 既存サマリーレコード取得
        let summaryRecord = await getProjectionRecord(summaryId);
        
        if (summaryRecord) {
          // 更新
          const updateData = {
            [CONFIG.FIELDS.PROJECTION.ACTUAL_RECEIVED_QTY]: { 
              value: (UTILS.getNumberValue(summaryRecord, CONFIG.FIELDS.PROJECTION.ACTUAL_RECEIVED_QTY) || 0) + quantities.receivedQty
            },
            [CONFIG.FIELDS.PROJECTION.ACTUAL_ISSUED_QTY]: { 
              value: (UTILS.getNumberValue(summaryRecord, CONFIG.FIELDS.PROJECTION.ACTUAL_ISSUED_QTY) || 0) + quantities.issuedQty
            }
          };
          
          // ending_qty を再計算
          const beginningQty = UTILS.getNumberValue(summaryRecord, CONFIG.FIELDS.PROJECTION.BEGINNING_QTY) || 0;
          const actualReceivedQty = updateData[CONFIG.FIELDS.PROJECTION.ACTUAL_RECEIVED_QTY].value;
          const actualIssuedQty = updateData[CONFIG.FIELDS.PROJECTION.ACTUAL_ISSUED_QTY].value;
          
          updateData[CONFIG.FIELDS.PROJECTION.ENDING_QTY] = { 
            value: beginningQty + actualReceivedQty - actualIssuedQty
          };
          
          await updateProjectionRecord(summaryRecord.$id.value, updateData);
          
        } else {
          // 新規作成
          const createData = {
            [CONFIG.FIELDS.PROJECTION.SUMMARY_ID]: { value: summaryId },
            [CONFIG.FIELDS.PROJECTION.SUMMARY_DATE]: { value: date },
            [CONFIG.FIELDS.PROJECTION.ITEM_CODE]: { value: itemCode },
            [CONFIG.FIELDS.PROJECTION.WAREHOUSE]: { value: warehouse },
            [CONFIG.FIELDS.PROJECTION.LOCATION]: { value: location },
            [CONFIG.FIELDS.PROJECTION.BEGINNING_QTY]: { value: 0 },
            [CONFIG.FIELDS.PROJECTION.ACTUAL_RECEIVED_QTY]: { value: quantities.receivedQty },
            [CONFIG.FIELDS.PROJECTION.ACTUAL_ISSUED_QTY]: { value: quantities.issuedQty },
            [CONFIG.FIELDS.PROJECTION.ENDING_QTY]: { value: quantities.receivedQty - quantities.issuedQty }
          };
          
          await createProjectionRecord(createData);
        }
        
      } catch (error) {
        UTILS.error(`サマリー更新エラー (${summaryId}):`, error);
      }
    }

    UTILS.log(`在庫推移サマリー更新完了: ${itemCode}-${warehouse}-${location}`);
  }

  /**
   * 発注残数 (received_qty) を更新
   */
  async function updatePOReceivedQty(records) {
    // 発注番号が存在するレコードのみ
    const poRecords = records.filter(r => {
      const poNumber = UTILS.getFieldValue(r, FIELDS.PO_NUMBER);
      const transactionType = UTILS.getFieldValue(r, FIELDS.TRANSACTION_TYPE);
      const status = UTILS.getFieldValue(r, FIELDS.STATUS);
      
      return poNumber && transactionType === '入庫' && status === '確定';
    });

    if (poRecords.length === 0) {
      return;
    }

    // 発注番号 + 品目コードごとにグループ化
    const poGroups = {};
    
    poRecords.forEach(record => {
      const poNumber = UTILS.getFieldValue(record, FIELDS.PO_NUMBER);
      const itemCode = UTILS.getFieldValue(record, FIELDS.ITEM_CODE);
      const quantity = UTILS.getNumberValue(record, FIELDS.QUANTITY);
      
      const key = `${poNumber}-${itemCode}`;
      
      if (!poGroups[key]) {
        poGroups[key] = {
          poNumber,
          itemCode,
          totalQty: 0
        };
      }
      
      poGroups[key].totalQty += quantity;
    });

    // 各発注レコードを更新
    for (const [key, data] of Object.entries(poGroups)) {
      try {
        // 発注レコード取得
        const poRecord = await getPORecord(data.poNumber);
        
        if (!poRecord) {
          UTILS.warn(`発注レコードが見つかりません: ${data.poNumber}`);
          continue;
        }

        // po_items テーブルから該当品目を検索
        const poItems = UTILS.getFieldValue(poRecord, PO_FIELDS.PO_ITEMS) || [];
        const targetItem = poItems.find(item => 
          UTILS.getFieldValue(item.value, CONFIG.FIELDS.PO_ITEM.ITEM_CODE) === data.itemCode
        );

        if (!targetItem) {
          UTILS.warn(`品目が発注に存在しません: ${data.poNumber} - ${data.itemCode}`);
          continue;
        }

        // received_qty を更新
        const currentReceivedQty = UTILS.getNumberValue(targetItem.value, CONFIG.FIELDS.PO_ITEM.RECEIVED_QTY) || 0;
        const newReceivedQty = currentReceivedQty + data.totalQty;
        
        targetItem.value[CONFIG.FIELDS.PO_ITEM.RECEIVED_QTY] = { value: newReceivedQty };

        // remaining_qty と delivery_status は自動計算されるため、ここでは更新不要
        // (po_integration_v2.1.js が自動で計算)

        // 発注レコードを更新
        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
          app: APP_IDS.PO_MANAGEMENT,
          id: poRecord.$id.value,
          record: {
            [PO_FIELDS.PO_ITEMS]: { value: poItems.map(item => item.value) }
          }
        });

        UTILS.log(`発注残数更新: ${data.poNumber} - ${data.itemCode} (+${data.totalQty})`);

      } catch (error) {
        UTILS.error(`発注残数更新エラー (${key}):`, error);
      }
      
      await UTILS.sleep(BATCH_CONFIG.DELAY);
    }
  }

  /**
   * アラートフラグ判定
   */
  function getAlertFlag(currentQty, safetyStock) {
    if (currentQty <= 0) return '在庫切れ';
    if (currentQty < safetyStock) return '在庫少';
    return '正常';
  }

  /**
   * 在庫残高レコード取得
   */
  async function getBalanceRecord(balanceId) {
    try {
      const query = `${CONFIG.FIELDS.BALANCE.BALANCE_ID} = "${balanceId}"`;
      const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
        app: APP_IDS.INVENTORY_BALANCE,
        query: query
      });
      return resp.records && resp.records.length > 0 ? resp.records[0] : null;
    } catch (error) {
      UTILS.error('在庫残高レコード取得エラー:', error);
      return null;
    }
  }

  /**
   * 在庫残高レコード更新
   */
  async function updateBalanceRecord(recordId, data) {
    try {
      await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
        app: APP_IDS.INVENTORY_BALANCE,
        id: recordId,
        record: data
      });
    } catch (error) {
      UTILS.error('在庫残高レコード更新エラー:', error);
      throw error;
    }
  }

  /**
   * 在庫残高レコード作成
   */
  async function createBalanceRecord(data) {
    try {
      await kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
        app: APP_IDS.INVENTORY_BALANCE,
        record: data
      });
    } catch (error) {
      UTILS.error('在庫残高レコード作成エラー:', error);
      throw error;
    }
  }

  /**
   * 在庫推移サマリーレコード取得
   */
  async function getProjectionRecord(summaryId) {
    try {
      const query = `${CONFIG.FIELDS.PROJECTION.SUMMARY_ID} = "${summaryId}"`;
      const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
        app: APP_IDS.INVENTORY_PROJECTION,
        query: query
      });
      return resp.records && resp.records.length > 0 ? resp.records[0] : null;
    } catch (error) {
      UTILS.error('在庫推移サマリーレコード取得エラー:', error);
      return null;
    }
  }

  /**
   * 在庫推移サマリーレコード更新
   */
  async function updateProjectionRecord(recordId, data) {
    try {
      await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
        app: APP_IDS.INVENTORY_PROJECTION,
        id: recordId,
        record: data
      });
    } catch (error) {
      UTILS.error('在庫推移サマリーレコード更新エラー:', error);
      throw error;
    }
  }

  /**
   * 在庫推移サマリーレコード作成
   */
  async function createProjectionRecord(data) {
    try {
      await kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
        app: APP_IDS.INVENTORY_PROJECTION,
        record: data
      });
    } catch (error) {
      UTILS.error('在庫推移サマリーレコード作成エラー:', error);
      throw error;
    }
  }

  /**
   * 発注レコード取得
   */
  async function getPORecord(poNumber) {
    try {
      const query = `${PO_FIELDS.PO_NUMBER} = "${poNumber}"`;
      const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
        app: APP_IDS.PO_MANAGEMENT,
        query: query
      });
      return resp.records && resp.records.length > 0 ? resp.records[0] : null;
    } catch (error) {
      UTILS.error('発注レコード取得エラー:', error);
      return null;
    }
  }

  /**
   * レコードを処理済みにマーク
   */
  async function markRecordsAsProcessed(recordIds) {
    if (recordIds.length === 0) return;

    try {
      const records = recordIds.map(id => ({
        id: id,
        record: {
          [FIELDS.PROCESSED_FLAG]: { value: ['処理済み'] }
        }
      }));

      // 100件ずつ分割して更新
      for (let i = 0; i < records.length; i += BATCH_CONFIG.BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_CONFIG.BATCH_SIZE);
        
        await kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', {
          app: APP_IDS.INVENTORY_TRANSACTION,
          records: batch
        });
        
        await UTILS.sleep(BATCH_CONFIG.DELAY);
      }

      UTILS.log(`処理済みフラグ更新: ${recordIds.length}件`);
    } catch (error) {
      UTILS.error('処理済みフラグ更新エラー:', error);
      throw error;
    }
  }

  /**
   * プログレスバー表示
   */
  function showProgressBar(current, total) {
    // 既存のプログレスバーがあれば削除
    const existing = document.getElementById('batch-progress-container');
    if (existing) {
      existing.remove();
    }

    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

    const html = `
      <div id="batch-progress-container" style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 2px solid #3498db;
        border-radius: 8px;
        padding: 30px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 10000;
        min-width: 400px;
      ">
        <h3 style="margin: 0 0 20px 0; color: #2c3e50;">在庫一括更新中...</h3>
        <div style="
          background: #ecf0f1;
          border-radius: 10px;
          height: 30px;
          overflow: hidden;
          margin-bottom: 15px;
        ">
          <div id="batch-progress-bar" style="
            background: linear-gradient(90deg, #3498db, #2ecc71);
            height: 100%;
            width: ${percentage}%;
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
          ">
            ${percentage}%
          </div>
        </div>
        <p id="batch-progress-text" style="
          margin: 0;
          color: #7f8c8d;
          text-align: center;
        ">
          ${current} / ${total} 件処理済み
        </p>
      </div>
      <div id="batch-progress-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 9999;
      "></div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
  }

  /**
   * プログレスバー更新
   */
  function updateProgressBar(current, total) {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const bar = document.getElementById('batch-progress-bar');
    const text = document.getElementById('batch-progress-text');

    if (bar) {
      bar.style.width = `${percentage}%`;
      bar.textContent = `${percentage}%`;
    }

    if (text) {
      text.textContent = `${current} / ${total} 件処理済み`;
    }
  }

  /**
   * プログレスバー非表示
   */
  function hideProgressBar() {
    const container = document.getElementById('batch-progress-container');
    const overlay = document.getElementById('batch-progress-overlay');
    
    if (container) container.remove();
    if (overlay) overlay.remove();
  }

  /**
   * 結果サマリー表示
   */
  function showResultSummary(processedCount, errorCount, errors) {
    const hasErrors = errorCount > 0;
    const bgColor = hasErrors ? '#e74c3c' : '#2ecc71';
    const icon = hasErrors ? '⚠️' : '✅';
    const title = hasErrors ? '一括更新完了（一部エラーあり）' : '一括更新完了';

    let errorHtml = '';
    if (hasErrors && errors.length > 0) {
      errorHtml = `
        <div style="
          max-height: 200px;
          overflow-y: auto;
          background: #fff5f5;
          border: 1px solid #e74c3c;
          border-radius: 4px;
          padding: 10px;
          margin-top: 15px;
        ">
          <h4 style="margin: 0 0 10px 0; color: #e74c3c;">エラー詳細:</h4>
          ${errors.map(e => `
            <div style="margin-bottom: 10px; padding: 5px; background: white; border-radius: 3px;">
              <strong>${e.key}</strong><br>
              <span style="color: #666;">${e.error}</span><br>
              <small style="color: #999;">レコードID: ${e.recordIds.join(', ')}</small>
            </div>
          `).join('')}
        </div>
      `;
    }

    const html = `
      <div id="batch-result-container" style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 3px solid ${bgColor};
        border-radius: 12px;
        padding: 40px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.3);
        z-index: 10000;
        min-width: 500px;
        max-width: 700px;
      ">
        <h2 style="margin: 0 0 20px 0; color: ${bgColor};">
          ${icon} ${title}
        </h2>
        <div style="
          background: #f8f9fa;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
        ">
          <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
            <span style="font-weight: bold;">処理成功:</span>
            <span style="color: #2ecc71; font-size: 20px; font-weight: bold;">${processedCount}件</span>
          </div>
          ${hasErrors ? `
            <div style="display: flex; justify-content: space-between;">
              <span style="font-weight: bold;">処理失敗:</span>
              <span style="color: #e74c3c; font-size: 20px; font-weight: bold;">${errorCount}件</span>
            </div>
          ` : ''}
        </div>
        ${errorHtml}
        <button id="batch-result-close" style="
          background: ${bgColor};
          color: white;
          border: none;
          border-radius: 6px;
          padding: 12px 30px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          width: 100%;
          margin-top: 20px;
        ">
          閉じる
        </button>
      </div>
      <div id="batch-result-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.6);
        z-index: 9999;
      "></div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // 閉じるボタンのイベント
    document.getElementById('batch-result-close').addEventListener('click', () => {
      document.getElementById('batch-result-container').remove();
      document.getElementById('batch-result-overlay').remove();
      
      // ページをリロードして最新状態を表示
      location.reload();
    });
  }

  /**
   * 一括更新ボタン追加
   */
  kintone.events.on('app.record.index.show', (event) => {
    // 既存ボタンがあれば削除(二重追加防止)
    const existingButton = document.getElementById('batch-update-button');
    if (existingButton) {
      existingButton.remove();
    }

    // ヘッダーメニュースペースにボタン追加
    const headerSpace = kintone.app.getHeaderMenuSpaceElement();
    if (!headerSpace) return event;

    const button = document.createElement('button');
    button.id = 'batch-update-button';
    button.textContent = '🔄 在庫一括更新';
    button.style.cssText = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      transition: all 0.3s ease;
      margin-right: 10px;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-2px)';
      button.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
    });

    button.addEventListener('click', async () => {
      // 確認ダイアログ
      if (!confirm('未処理の在庫取引レコードを一括更新しますか?\n\n※ 処理には時間がかかる場合があります')) {
        return;
      }

      button.disabled = true;
      button.textContent = '処理中...';

      try {
        await batchUpdateInventory();
      } catch (error) {
        UTILS.error('一括更新エラー:', error);
      } finally {
        button.disabled = false;
        button.textContent = '🔄 在庫一括更新';
      }
    });

    headerSpace.appendChild(button);

    return event;
  });

  // グローバルに公開
  window.InventoryBatchUpdate = {
    VERSION: '2.1',
    batchUpdateInventory: batchUpdateInventory
  };

  UTILS.log('[INVENTORY] Batch Update Script loaded - Version: 2.1');

})();
