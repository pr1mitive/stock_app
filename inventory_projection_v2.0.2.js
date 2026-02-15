/**
 * 在庫推移サマリー更新スクリプト（完全版 - 完全修正版）
 * Version: 2.0.2
 * 在庫取引が発生したときに在庫推移サマリーを自動更新
 * 
 * 更新範囲:
 * - 過去30日間のサマリー
 * - 未来90日間のサマリー（予測）
 * 
 * 修正内容 (v2.0.2):
 * - 当日の入庫・出庫実績が正しく集計されるように修正
 * - projected_ending_qty が正しく累積されるように修正
 * - デバッグログを強化
 * 
 * @requires inventory_config.js, inventory_utils.js
 */

(function() {
  'use strict';

  const CONFIG = window.INVENTORY_CONFIG;
  const Utils = window.InventoryUtils;

  if (!CONFIG || !Utils) {
    console.error('[INVENTORY] 依存ファイルが読み込まれていません');
    return;
  }

  console.log('[INVENTORY] Projection Script loaded - Version: 2.0.2');

  // 設定
  const PAST_DAYS = 30;   // 過去30日
  const FUTURE_DAYS = 90; // 未来90日

  /**
   * 在庫推移サマリーを更新
   * @param {string} itemCode - 品目コード
   * @param {string} warehouse - 倉庫コード
   * @param {string} location - ロケーション
   */
  async function updateInventoryProjection(itemCode, warehouse, location) {
    try {
      Utils.log(`在庫推移サマリー更新開始: ${itemCode} - ${warehouse} - ${location}`);

      // 日付範囲を計算
      const today = new Date();
      const todayStr = Utils.formatDate(today);
      const startDate = Utils.addDays(today, -PAST_DAYS);
      const endDate = Utils.addDays(today, FUTURE_DAYS);

      Utils.log(`更新範囲: ${Utils.formatDate(startDate)} 〜 ${Utils.formatDate(endDate)}`);
      Utils.log(`今日の日付: ${todayStr}`);

      // 在庫残高を取得（現在の在庫数）
      const balanceId = `BAL-${itemCode}-${warehouse}-${location}`;
      const balanceRecords = await Utils.getRecords(
        CONFIG.APP_IDS.INVENTORY_BALANCE,
        `balance_id = "${balanceId}"`
      );

      let currentQty = 0;
      if (balanceRecords && balanceRecords.length > 0) {
        currentQty = Utils.getNumberValue(balanceRecords[0], CONFIG.FIELDS.BALANCE.CURRENT_QTY);
      }

      Utils.log(`現在在庫数（在庫残高アプリ）: ${currentQty}`);

      // 在庫取引を取得（過去30日〜未来90日）
      // 重要: 今日を含む全範囲を取得
      const startDateStr = Utils.formatDate(startDate);
      const endDateStr = Utils.formatDate(endDate);
      
      const query = `${CONFIG.FIELDS.TRANSACTION.ITEM_CODE} = "${itemCode}" and ` +
                    `${CONFIG.FIELDS.TRANSACTION.WAREHOUSE} = "${warehouse}" and ` +
                    `${CONFIG.FIELDS.TRANSACTION.LOCATION} = "${location}" and ` +
                    `${CONFIG.FIELDS.TRANSACTION.TRANSACTION_DATE} >= "${startDateStr}" and ` +
                    `${CONFIG.FIELDS.TRANSACTION.TRANSACTION_DATE} <= "${endDateStr}" ` +
                    `order by ${CONFIG.FIELDS.TRANSACTION.TRANSACTION_DATE} asc`;

      Utils.log(`取引取得クエリ: ${query}`);

      const transactions = await Utils.getAllRecords(
        CONFIG.APP_IDS.INVENTORY_TRANSACTION,
        query
      );

      Utils.log(`取得した取引レコード数: ${transactions.length}`);

      // 日付ごとに取引を集計
      const dailyTransactions = aggregateTransactionsByDate(transactions);

      Utils.log(`集計した日数: ${dailyTransactions.size}日分`);

      // デバッグ: 今日の取引を確認
      const todayData = dailyTransactions.get(todayStr);
      if (todayData) {
        Utils.log(`✅ 今日(${todayStr})の取引が見つかりました:`, todayData);
      } else {
        Utils.warn(`⚠️ 今日(${todayStr})の取引が見つかりません`);
      }

      // 今日の期首在庫を逆算
      // 現在在庫 = 今日の期首 + 今日の確定入庫 - 今日の確定出庫
      // → 今日の期首 = 現在在庫 - 今日の確定入庫 + 今日の確定出庫
      const todayTx = dailyTransactions.get(todayStr) || { 
        received_qty: 0, 
        issued_qty: 0,
        planned_received_qty: 0,
        planned_issued_qty: 0
      };
      
      const todayOpening = currentQty - todayTx.received_qty + todayTx.issued_qty;

      Utils.log(`=== 今日の計算 ===`);
      Utils.log(`現在在庫: ${currentQty}`);
      Utils.log(`今日の確定入庫: ${todayTx.received_qty}`);
      Utils.log(`今日の確定出庫: ${todayTx.issued_qty}`);
      Utils.log(`今日の期首在庫（逆算）: ${todayOpening} = ${currentQty} - ${todayTx.received_qty} + ${todayTx.issued_qty}`);
      Utils.log(`今日の期末在庫（検証）: ${todayOpening + todayTx.received_qty - todayTx.issued_qty} (should be ${currentQty})`);

      // 各日付のサマリーを作成
      const summaryData = [];

      // ステップ1: 過去30日分を逆算
      let pastRunningQty = todayOpening;

      for (let i = PAST_DAYS; i > 0; i--) {
        const targetDate = Utils.addDays(today, -i);
        const dateStr = Utils.formatDate(targetDate);
        const dailyData = dailyTransactions.get(dateStr) || {
          received_qty: 0,
          issued_qty: 0,
          planned_received_qty: 0,
          planned_issued_qty: 0
        };

        // 前日の期首を逆算
        pastRunningQty = pastRunningQty - dailyData.received_qty + dailyData.issued_qty;

        const endingQty = pastRunningQty + dailyData.received_qty - dailyData.issued_qty;
        const projectedEndingQty = endingQty + dailyData.planned_received_qty - dailyData.planned_issued_qty;

        summaryData.push({
          date: dateStr,
          opening_qty: pastRunningQty,
          received_qty: dailyData.received_qty,
          issued_qty: dailyData.issued_qty,
          ending_qty: endingQty,
          planned_received_qty: dailyData.planned_received_qty,
          planned_issued_qty: dailyData.planned_issued_qty,
          projected_ending_qty: projectedEndingQty
        });
      }

      // ステップ2: 今日と未来90日分を順算
      let futureRunningQty = todayOpening;
      let projectedRunningQty = todayOpening; // 予測在庫の累積用

      for (let i = 0; i <= FUTURE_DAYS; i++) {
        const targetDate = Utils.addDays(today, i);
        const dateStr = Utils.formatDate(targetDate);
        const dailyData = dailyTransactions.get(dateStr) || {
          received_qty: 0,
          issued_qty: 0,
          planned_received_qty: 0,
          planned_issued_qty: 0
        };

        const openingQty = futureRunningQty;
        const endingQty = openingQty + dailyData.received_qty - dailyData.issued_qty;
        
        // 予測在庫の累積計算
        // 予測期首 = 前日の予測期末
        const projectedOpeningQty = projectedRunningQty;
        // 予測期末 = 予測期首 + 確定入庫 - 確定出庫 + 予定入庫 - 予定出庫
        const projectedEndingQty = projectedOpeningQty + 
                                   dailyData.received_qty - 
                                   dailyData.issued_qty + 
                                   dailyData.planned_received_qty - 
                                   dailyData.planned_issued_qty;

        summaryData.push({
          date: dateStr,
          opening_qty: openingQty,
          received_qty: dailyData.received_qty,
          issued_qty: dailyData.issued_qty,
          ending_qty: endingQty,
          planned_received_qty: dailyData.planned_received_qty,
          planned_issued_qty: dailyData.planned_issued_qty,
          projected_ending_qty: projectedEndingQty
        });

        // 次の日の期首在庫 = 今日の期末在庫
        futureRunningQty = endingQty;
        // 次の日の予測期首 = 今日の予測期末
        projectedRunningQty = projectedEndingQty;

        // デバッグ: 最初の数日分をログ出力
        if (i <= 3) {
          Utils.log(`${dateStr}: 期首=${openingQty}, 入庫=${dailyData.received_qty}, 出庫=${dailyData.issued_qty}, 期末=${endingQty}, 予測期末=${projectedEndingQty}`);
        }
      }

      // デバッグ: 今日のサマリーを確認
      const todaySummary = summaryData.find(s => s.date === todayStr);
      if (todaySummary) {
        Utils.log(`✅ 今日のサマリー生成完了:`, todaySummary);
      } else {
        Utils.error(`❌ 今日のサマリーが生成されませんでした`);
      }

      // サマリーレコードを作成・更新
      await upsertSummaryRecords(itemCode, warehouse, location, summaryData);

      Utils.log(`✅ 在庫推移サマリー更新完了: ${summaryData.length}件`);

      // 在庫切れアラートをチェック
      checkStockoutAlert(summaryData);

    } catch (error) {
      Utils.error('在庫推移サマリー更新エラー:', error);
      throw error;
    }
  }

  /**
   * 日付ごとに取引を集計
   */
  function aggregateTransactionsByDate(transactions) {
    const dailyMap = new Map();

    transactions.forEach(tx => {
      const date = Utils.getFieldValue(tx, CONFIG.FIELDS.TRANSACTION.TRANSACTION_DATE);
      const status = Utils.getFieldValue(tx, CONFIG.FIELDS.TRANSACTION.STATUS);
      const type = Utils.getFieldValue(tx, CONFIG.FIELDS.TRANSACTION.TRANSACTION_TYPE);
      const quantity = Utils.getNumberValue(tx, CONFIG.FIELDS.TRANSACTION.QUANTITY);
      const txId = Utils.getFieldValue(tx, CONFIG.FIELDS.TRANSACTION.TRANSACTION_ID);

      // デバッグログ
      console.log(`[INVENTORY] 取引集計: ${date}, ${status}, ${type}, ${quantity}個, ID=${txId}`);

      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          received_qty: 0,
          issued_qty: 0,
          planned_received_qty: 0,
          planned_issued_qty: 0
        });
      }

      const daily = dailyMap.get(date);

      // ステータスが「確定」の場合
      if (status === CONFIG.STATUSES.CONFIRMED) {
        if (type === CONFIG.TRANSACTION_TYPES.RECEIVED || type === CONFIG.TRANSACTION_TYPES.INITIAL) {
          daily.received_qty += quantity;
          console.log(`  → 確定入庫: +${quantity}, 合計=${daily.received_qty}`);
        } else if (type === CONFIG.TRANSACTION_TYPES.ISSUED) {
          daily.issued_qty += quantity;
          console.log(`  → 確定出庫: +${quantity}, 合計=${daily.issued_qty}`);
        } else if (type === CONFIG.TRANSACTION_TYPES.ADJUSTMENT) {
          // 棚卸調整は実地棚卸数を使用
          const physicalCount = Utils.getNumberValue(tx, CONFIG.FIELDS.TRANSACTION.PHYSICAL_COUNT);
          const beforeQty = Utils.getNumberValue(tx, CONFIG.FIELDS.TRANSACTION.BEFORE_QTY);
          const diff = physicalCount - beforeQty;
          if (diff > 0) {
            daily.received_qty += diff;
          } else if (diff < 0) {
            daily.issued_qty += Math.abs(diff);
          }
        }
      }
      // ステータスが「予定」の場合
      else if (status === CONFIG.STATUSES.PLANNED) {
        if (type === CONFIG.TRANSACTION_TYPES.RECEIVED || type === CONFIG.TRANSACTION_TYPES.INITIAL) {
          daily.planned_received_qty += quantity;
          console.log(`  → 予定入庫: +${quantity}, 合計=${daily.planned_received_qty}`);
        } else if (type === CONFIG.TRANSACTION_TYPES.ISSUED) {
          daily.planned_issued_qty += quantity;
          console.log(`  → 予定出庫: +${quantity}, 合計=${daily.planned_issued_qty}`);
        }
      }
    });

    return dailyMap;
  }

  /**
   * サマリーレコードを作成または更新
   */
  async function upsertSummaryRecords(itemCode, warehouse, location, summaryData) {
    // 既存のサマリーレコードを取得
    const startDate = summaryData[0].date;
    const endDate = summaryData[summaryData.length - 1].date;
    
    const query = `${CONFIG.FIELDS.PROJECTION.ITEM_CODE} = "${itemCode}" and ` +
                  `${CONFIG.FIELDS.PROJECTION.WAREHOUSE} = "${warehouse}" and ` +
                  `${CONFIG.FIELDS.PROJECTION.LOCATION} = "${location}" and ` +
                  `${CONFIG.FIELDS.PROJECTION.SUMMARY_DATE} >= "${startDate}" and ` +
                  `${CONFIG.FIELDS.PROJECTION.SUMMARY_DATE} <= "${endDate}"`;

    const existingRecords = await Utils.getAllRecords(
      CONFIG.APP_IDS.INVENTORY_PROJECTION,
      query
    );

    // 既存レコードをMapに変換
    const existingMap = new Map();
    existingRecords.forEach(record => {
      const summaryId = Utils.getFieldValue(record, CONFIG.FIELDS.PROJECTION.SUMMARY_ID);
      existingMap.set(summaryId, record);
    });

    // 作成・更新するレコードを分類
    const recordsToCreate = [];
    const recordsToUpdate = [];

    for (const data of summaryData) {
      const summaryId = `SUM-${itemCode}-${warehouse}-${location}-${data.date.replace(/-/g, '')}`;
      const existing = existingMap.get(summaryId);

      const recordData = {
        [CONFIG.FIELDS.PROJECTION.SUMMARY_ID]: { value: summaryId },
        [CONFIG.FIELDS.PROJECTION.SUMMARY_DATE]: { value: data.date },
        [CONFIG.FIELDS.PROJECTION.ITEM_CODE]: { value: itemCode },
        [CONFIG.FIELDS.PROJECTION.WAREHOUSE]: { value: warehouse },
        [CONFIG.FIELDS.PROJECTION.LOCATION]: { value: location },
        [CONFIG.FIELDS.PROJECTION.OPENING_QTY]: { value: data.opening_qty },
        [CONFIG.FIELDS.PROJECTION.RECEIVED_QTY]: { value: data.received_qty },
        [CONFIG.FIELDS.PROJECTION.ISSUED_QTY]: { value: data.issued_qty },
        [CONFIG.FIELDS.PROJECTION.ENDING_QTY]: { value: data.ending_qty },
        [CONFIG.FIELDS.PROJECTION.PLANNED_RECEIVED_QTY]: { value: data.planned_received_qty },
        [CONFIG.FIELDS.PROJECTION.PLANNED_ISSUED_QTY]: { value: data.planned_issued_qty },
        [CONFIG.FIELDS.PROJECTION.PROJECTED_ENDING_QTY]: { value: data.projected_ending_qty }
      };

      if (existing) {
        // 更新
        recordsToUpdate.push({
          id: existing.$id.value,
          record: recordData
        });
      } else {
        // 新規作成
        recordsToCreate.push(recordData);
      }
    }

    // 一括作成（最大100件ずつ）
    if (recordsToCreate.length > 0) {
      Utils.log(`サマリーレコード作成: ${recordsToCreate.length}件`);
      
      for (let i = 0; i < recordsToCreate.length; i += 100) {
        const chunk = recordsToCreate.slice(i, i + 100);
        await kintone.api(
          kintone.api.url('/k/v1/records', true),
          'POST',
          {
            app: CONFIG.APP_IDS.INVENTORY_PROJECTION,
            records: chunk
          }
        );
      }
    }

    // 一括更新（最大100件ずつ）
    if (recordsToUpdate.length > 0) {
      Utils.log(`サマリーレコード更新: ${recordsToUpdate.length}件`);
      
      for (let i = 0; i < recordsToUpdate.length; i += 100) {
        const chunk = recordsToUpdate.slice(i, i + 100);
        await kintone.api(
          kintone.api.url('/k/v1/records', true),
          'PUT',
          {
            app: CONFIG.APP_IDS.INVENTORY_PROJECTION,
            records: chunk
          }
        );
      }
    }
  }

  /**
   * 在庫切れアラートをチェック
   */
  function checkStockoutAlert(summaryData) {
    const today = Utils.formatDate(new Date());
    let firstStockoutDate = null;

    for (const data of summaryData) {
      // 未来の日付で予測在庫が0以下
      if (data.date > today && data.projected_ending_qty <= 0) {
        firstStockoutDate = data.date;
        break;
      }
    }

    if (firstStockoutDate) {
      const daysUntil = Utils.diffDays(new Date(firstStockoutDate), new Date(today));
      Utils.warn(`⚠️ 在庫切れ予測: ${firstStockoutDate} (${daysUntil}日後)`);
      Utils.showAlert(
        `⚠️ ${daysUntil}日後 (${firstStockoutDate}) に在庫切れが予測されます`,
        'warning'
      );
    }
  }

  /**
   * 在庫取引から影響を受ける品目・倉庫・ロケーションを抽出
   */
  function getAffectedItems(record) {
    const itemCode = Utils.getFieldValue(record, CONFIG.FIELDS.TRANSACTION.ITEM_CODE);
    const warehouse = Utils.getFieldValue(record, CONFIG.FIELDS.TRANSACTION.WAREHOUSE);
    const location = Utils.getFieldValue(record, CONFIG.FIELDS.TRANSACTION.LOCATION);

    if (!itemCode || !warehouse || !location) {
      return null;
    }

    return { itemCode, warehouse, location };
  }

  /**
   * 在庫取引アプリのイベント監視（作成）
   */
  kintone.events.on([
    'app.record.create.submit.success'
  ], async function(event) {
    const record = event.record;
    
    const affected = getAffectedItems(record);
    if (!affected) {
      return event;
    }

    Utils.log('在庫取引作成 → サマリー更新開始');

    try {
      await updateInventoryProjection(
        affected.itemCode,
        affected.warehouse,
        affected.location
      );
    } catch (error) {
      Utils.error('サマリー更新エラー:', error);
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
    
    const affected = getAffectedItems(record);
    if (!affected) {
      return event;
    }

    Utils.log('在庫取引編集 → サマリー更新開始');

    try {
      await updateInventoryProjection(
        affected.itemCode,
        affected.warehouse,
        affected.location
      );
    } catch (error) {
      Utils.error('サマリー更新エラー:', error);
    }

    return event;
  });

  /**
   * 在庫取引アプリのイベント監視（削除）
   */
  kintone.events.on([
    'app.record.detail.delete.submit'
  ], async function(event) {
    const record = event.record;
    
    const affected = getAffectedItems(record);
    if (!affected) {
      return event;
    }

    Utils.log('在庫取引削除 → サマリー更新開始');

    try {
      // 削除後に非同期でサマリー更新
      setTimeout(async () => {
        try {
          await updateInventoryProjection(
            affected.itemCode,
            affected.warehouse,
            affected.location
          );
        } catch (error) {
          Utils.error('サマリー更新エラー:', error);
        }
      }, 1000);
    } catch (error) {
      Utils.error('サマリー更新エラー:', error);
    }

    return event;
  });

  // グローバル公開
  window.InventoryProjection = {
    updateInventoryProjection: updateInventoryProjection,
    VERSION: '2.0.2'
  };

  console.log('[INVENTORY] ✅ Projection Script initialized');

})();
