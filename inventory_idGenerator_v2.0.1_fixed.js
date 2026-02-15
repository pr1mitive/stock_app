/**
 * kintone 在庫管理システム - ID自動生成
 * 
 * レコード番号方式（確実性重視）:
 * - transaction_id: TRX-20260215-101 (日付 + レコード番号)
 * - balance_id: BAL-A001-TKY-A01 (複合キー)
 * - summary_id: SUM-A001-TKY-A01-20260215 (複合キー + 日付)
 * 
 * @version 2.0.1
 * @date 2026-02-15
 * @update 倉庫マスタ対応（warehouse フィールドには既に倉庫コードが入っている）
 * @requires inventory_config.js, inventory_utils.js
 */

(function(PLUGIN_ID) {
  'use strict';

  // 依存関係チェック
  if (!window.INVENTORY_CONFIG || !window.InventoryUtils) {
    console.error('[INVENTORY] 依存ファイルが読み込まれていません');
    return;
  }

  const CONFIG = window.INVENTORY_CONFIG;
  const Utils = window.InventoryUtils;
  const APP_IDS = CONFIG.APP_IDS;
  const FIELDS = CONFIG.FIELDS;

  // =====================================================
  // 在庫取引アプリ: transaction_id 自動生成
  // =====================================================

  /**
   * transaction_id を生成
   * 形式: TRX-YYYYMMDD-### (レコード番号を使用)
   * 例: TRX-20260215-101
   * 
   * ※ レコード作成後に実行（レコード番号が必要なため）
   */
  kintone.events.on('app.record.create.submit.success', async (event) => {
    // 在庫取引アプリのみ
    if (event.appId !== APP_IDS.INVENTORY_TRANSACTION) return event;
    
    try {
      Utils.log('transaction_id 生成開始', event.recordId);
      
      const recordId = event.record.$id.value;
      const transactionDate = Utils.getFieldValue(event.record, FIELDS.TRANSACTION.TRANSACTION_DATE);
      
      // 日付文字列を生成
      const dateStr = Utils.formatDate(transactionDate, 'YYYYMMDD');
      
      // transaction_id を生成: TRX-YYYYMMDD-###
      const transactionId = `TRX-${dateStr}-${Utils.padZero(recordId, 3)}`;
      
      // レコードを更新
      await Utils.updateRecord(
        APP_IDS.INVENTORY_TRANSACTION,
        recordId,
        {
          [FIELDS.TRANSACTION.TRANSACTION_ID]: { value: transactionId }
        }
      );
      
      Utils.log('transaction_id 生成完了', transactionId);
      
    } catch (error) {
      Utils.error('transaction_id 生成エラー', error);
      // エラーが発生してもレコード作成は成功させる
    }
    
    return event;
  });

  // =====================================================
  // 在庫残高アプリ: balance_id 自動生成
  // =====================================================

  /**
   * balance_id を生成
   * 形式: BAL-{item_code}-{warehouse_code}-{location_code}
   * 例: BAL-A001-TKY-A01
   * 
   * ※ warehouse フィールドには既に倉庫コードが入っている（ルックアップ）
   * ※ レコード作成前に実行
   */
  kintone.events.on('app.record.create.submit', (event) => {
    // 在庫残高アプリのみ
    if (event.appId !== APP_IDS.INVENTORY_BALANCE) return event;
    
    try {
      Utils.log('balance_id 生成開始');
      
      const itemCode = Utils.getFieldValue(event.record, FIELDS.BALANCE.ITEM_CODE);
      const warehouseCode = Utils.getFieldValue(event.record, FIELDS.BALANCE.WAREHOUSE); // 既に倉庫コード
      const location = Utils.getFieldValue(event.record, FIELDS.BALANCE.LOCATION);
      
      // バリデーション
      if (!Utils.isRequired(itemCode)) {
        event.error = 'アイテムコードは必須です';
        return event;
      }
      if (!Utils.isRequired(warehouseCode)) {
        event.error = '倉庫は必須です';
        return event;
      }
      if (!Utils.isRequired(location)) {
        event.error = 'ロケーションは必須です';
        return event;
      }
      
      // ロケーションコードを正規化（オプション）
      const locationCode = normalizeLocationCode(location);
      
      // balance_id を生成: BAL-{item_code}-{warehouse_code}-{location_code}
      const balanceId = `BAL-${itemCode}-${warehouseCode}-${locationCode}`;
      
      Utils.setFieldValue(event.record, FIELDS.BALANCE.BALANCE_ID, balanceId);
      
      Utils.log('balance_id 生成完了', balanceId);
      
    } catch (error) {
      Utils.error('balance_id 生成エラー', error);
      event.error = `ID生成エラー: ${error.message}`;
    }
    
    return event;
  });

  /**
   * balance_id を再生成（更新時）
   * item_code, warehouse, location が変更された場合のみ
   */
  kintone.events.on('app.record.edit.submit', (event) => {
    // 在庫残高アプリのみ
    if (event.appId !== APP_IDS.INVENTORY_BALANCE) return event;
    
    try {
      const itemCode = Utils.getFieldValue(event.record, FIELDS.BALANCE.ITEM_CODE);
      const warehouseCode = Utils.getFieldValue(event.record, FIELDS.BALANCE.WAREHOUSE); // 既に倉庫コード
      const location = Utils.getFieldValue(event.record, FIELDS.BALANCE.LOCATION);
      const currentBalanceId = Utils.getFieldValue(event.record, FIELDS.BALANCE.BALANCE_ID);
      
      // ロケーションコードを正規化
      const locationCode = normalizeLocationCode(location);
      
      // 新しい balance_id を生成
      const newBalanceId = `BAL-${itemCode}-${warehouseCode}-${locationCode}`;
      
      // 変更があった場合のみ更新
      if (newBalanceId !== currentBalanceId) {
        Utils.setFieldValue(event.record, FIELDS.BALANCE.BALANCE_ID, newBalanceId);
        Utils.log('balance_id 再生成', newBalanceId);
      }
      
    } catch (error) {
      Utils.error('balance_id 再生成エラー', error);
    }
    
    return event;
  });

  // =====================================================
  // 在庫推移サマリーアプリ: summary_id 自動生成
  // =====================================================

  /**
   * summary_id を生成
   * 形式: SUM-{item_code}-{warehouse_code}-{location_code}-YYYYMMDD
   * 例: SUM-A001-TKY-A01-20260215
   * 
   * ※ warehouse フィールドには既に倉庫コードが入っている（ルックアップ）
   * ※ レコード作成前に実行
   */
  kintone.events.on('app.record.create.submit', (event) => {
    // 在庫推移サマリーアプリのみ
    if (event.appId !== APP_IDS.INVENTORY_PROJECTION) return event;
    
    try {
      Utils.log('summary_id 生成開始');
      
      const itemCode = Utils.getFieldValue(event.record, FIELDS.PROJECTION.ITEM_CODE);
      const warehouseCode = Utils.getFieldValue(event.record, FIELDS.PROJECTION.WAREHOUSE); // 既に倉庫コード
      const location = Utils.getFieldValue(event.record, FIELDS.PROJECTION.LOCATION);
      const summaryDate = Utils.getFieldValue(event.record, FIELDS.PROJECTION.SUMMARY_DATE);
      
      // バリデーション
      if (!Utils.isRequired(itemCode)) {
        event.error = 'アイテムコードは必須です';
        return event;
      }
      if (!Utils.isRequired(warehouseCode)) {
        event.error = '倉庫は必須です';
        return event;
      }
      if (!Utils.isRequired(location)) {
        event.error = 'ロケーションは必須です';
        return event;
      }
      if (!Utils.isRequired(summaryDate)) {
        event.error = '集計日は必須です';
        return event;
      }
      
      // ロケーションコードを正規化
      const locationCode = normalizeLocationCode(location);
      
      // 日付文字列を生成
      const dateStr = Utils.formatDate(summaryDate, 'YYYYMMDD');
      
      // summary_id を生成: SUM-{item_code}-{warehouse_code}-{location_code}-YYYYMMDD
      const summaryId = `SUM-${itemCode}-${warehouseCode}-${locationCode}-${dateStr}`;
      
      Utils.setFieldValue(event.record, FIELDS.PROJECTION.SUMMARY_ID, summaryId);
      
      Utils.log('summary_id 生成完了', summaryId);
      
    } catch (error) {
      Utils.error('summary_id 生成エラー', error);
      event.error = `ID生成エラー: ${error.message}`;
    }
    
    return event;
  });

  /**
   * summary_id を再生成（更新時）
   * item_code, warehouse, location, summary_date が変更された場合のみ
   */
  kintone.events.on('app.record.edit.submit', (event) => {
    // 在庫推移サマリーアプリのみ
    if (event.appId !== APP_IDS.INVENTORY_PROJECTION) return event;
    
    try {
      const itemCode = Utils.getFieldValue(event.record, FIELDS.PROJECTION.ITEM_CODE);
      const warehouseCode = Utils.getFieldValue(event.record, FIELDS.PROJECTION.WAREHOUSE); // 既に倉庫コード
      const location = Utils.getFieldValue(event.record, FIELDS.PROJECTION.LOCATION);
      const summaryDate = Utils.getFieldValue(event.record, FIELDS.PROJECTION.SUMMARY_DATE);
      const currentSummaryId = Utils.getFieldValue(event.record, FIELDS.PROJECTION.SUMMARY_ID);
      
      // ロケーションコードを正規化
      const locationCode = normalizeLocationCode(location);
      
      // 日付文字列を生成
      const dateStr = Utils.formatDate(summaryDate, 'YYYYMMDD');
      
      // 新しい summary_id を生成
      const newSummaryId = `SUM-${itemCode}-${warehouseCode}-${locationCode}-${dateStr}`;
      
      // 変更があった場合のみ更新
      if (newSummaryId !== currentSummaryId) {
        Utils.setFieldValue(event.record, FIELDS.PROJECTION.SUMMARY_ID, newSummaryId);
        Utils.log('summary_id 再生成', newSummaryId);
      }
      
    } catch (error) {
      Utils.error('summary_id 再生成エラー', error);
    }
    
    return event;
  });

  // =====================================================
  // ヘルパー関数
  // =====================================================

  /**
   * ロケーションコードを正規化
   * @param {string} location - ロケーション
   * @returns {string} 正規化されたロケーションコード
   */
  function normalizeLocationCode(location) {
    // そのまま返す（例: A-01, B-15）
    // 必要に応じて正規化処理を追加
    // 例: 大文字化、ハイフン統一など
    return location.toUpperCase().trim();
  }

  // =====================================================
  // 重複チェック（オプション）
  // =====================================================

  /**
   * balance_id の重複チェック
   * ※ 作成後に実行（重複が検出された場合はアラート表示）
   */
  kintone.events.on('app.record.create.submit.success', async (event) => {
    // 在庫残高アプリのみ
    if (event.appId !== APP_IDS.INVENTORY_BALANCE) return event;
    
    try {
      const balanceId = Utils.getFieldValue(event.record, FIELDS.BALANCE.BALANCE_ID);
      
      // 同じ balance_id が存在するか確認
      const query = `${FIELDS.BALANCE.BALANCE_ID} = "${balanceId}"`;
      const records = await Utils.getRecords(APP_IDS.INVENTORY_BALANCE, query);
      
      if (records.length > 1) {
        Utils.warn('balance_id が重複しています', balanceId);
        Utils.showAlert(
          `警告: 同じアイテム・倉庫・ロケーションの組み合わせが既に存在します (${balanceId})`,
          'warning'
        );
      }
      
    } catch (error) {
      Utils.error('balance_id 重複チェックエラー', error);
    }
    
    return event;
  });

  /**
   * summary_id の重複チェック
   * ※ 作成後に実行（重複が検出された場合はアラート表示）
   */
  kintone.events.on('app.record.create.submit.success', async (event) => {
    // 在庫推移サマリーアプリのみ
    if (event.appId !== APP_IDS.INVENTORY_PROJECTION) return event;
    
    try {
      const summaryId = Utils.getFieldValue(event.record, FIELDS.PROJECTION.SUMMARY_ID);
      
      // 同じ summary_id が存在するか確認
      const query = `${FIELDS.PROJECTION.SUMMARY_ID} = "${summaryId}"`;
      const records = await Utils.getRecords(APP_IDS.INVENTORY_PROJECTION, query);
      
      if (records.length > 1) {
        Utils.warn('summary_id が重複しています', summaryId);
        Utils.showAlert(
          `警告: 同じ日付・アイテム・倉庫・ロケーションの組み合わせが既に存在します (${summaryId})`,
          'warning'
        );
      }
      
    } catch (error) {
      Utils.error('summary_id 重複チェックエラー', error);
    }
    
    return event;
  });

  // =====================================================
  // グローバル公開（必要に応じて）
  // =====================================================
  window.INVENTORY_ID_GENERATOR = {
    normalizeLocationCode: normalizeLocationCode,
    VERSION: CONFIG.VERSION
  };

  Utils.log('ID Generator loaded - Version: ' + CONFIG.VERSION);

})(kintone.$PLUGIN_ID);
