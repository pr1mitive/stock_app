/**
 * kintone 在庫管理システム - 設定ファイル
 * 
 * App ID、フィールド名、定数などを一元管理
 * 
 * @version 2.0.4
 * @date 2026-02-15
 * @update 発注明細テーブル対応
 */

(function(PLUGIN_ID) {
  'use strict';

  // =====================================================
  // App ID 設定
  // =====================================================
  const APP_IDS = {
    // 既存アプリ
    ITEM_MASTER: 745,           // アイテムマスタ
    PO_MANAGEMENT: 748,         // 発注管理
    WAREHOUSE_MASTER: 747,      // 倉庫マスタ（追加）
    
    // 新規アプリ（在庫管理）
    INVENTORY_TRANSACTION: 760, // 在庫取引
    INVENTORY_BALANCE: 761,     // 在庫残高
    INVENTORY_PROJECTION: 762   // 在庫推移サマリー
  };

  // =====================================================
  // フィールドコード定義
  // =====================================================
  
  // 在庫取引アプリ
  const TRANSACTION_FIELDS = {
    // 基本情報
    TRANSACTION_ID: 'transaction_id',
    TRANSACTION_DATE: 'transaction_date',
    TRANSACTION_TYPE: 'transaction_type',
    STATUS: 'status',
    
    // アイテム情報
    ITEM_CODE: 'item_code',
    ITEM_NAME: 'item_name',
    QUANTITY: 'quantity',
    UNIT: 'unit',
    
    // ロケーション情報
    WAREHOUSE: 'warehouse',           // 倉庫コード（ルックアップ）
    WAREHOUSE_NAME: 'warehouse_name', // 倉庫名（ルックアップコピー）
    LOCATION: 'location',
    
    // 参照情報
    PROJECT_ID: 'project_id',
    PO_NUMBER: 'po_number',
    REFERENCE_TYPE: 'reference_type',
    
    // 金額情報
    UNIT_COST: 'unit_cost',
    AMOUNT: 'amount',
    
    // 在庫情報（実績のみ）
    BEFORE_QTY: 'before_qty',
    AFTER_QTY: 'after_qty',
    
    // 棚卸情報
    PHYSICAL_COUNT: 'physical_count',
    ADJUSTMENT_REASON: 'adjustment_reason',
    
    // その他
    REMARKS: 'remarks',
    CREATED_BY: 'created_by',
    UPDATED_AT: 'updated_at',
    
    // 一括更新用
    PROCESSED_FLAG: 'processed_flag'  // 処理フラグ（チェックボックス）
  };

  // 在庫残高アプリ
  const BALANCE_FIELDS = {
    // 複合キー
    BALANCE_ID: 'balance_id',
    ITEM_CODE: 'item_code',
    WAREHOUSE: 'warehouse',           // 倉庫コード（ルックアップ）
    WAREHOUSE_NAME: 'warehouse_name', // 倉庫名（ルックアップコピー）
    LOCATION: 'location',
    
    // アイテム情報
    ITEM_NAME: 'item_name',
    UNIT: 'unit',
    
    // 在庫数量
    CURRENT_QTY: 'current_qty',
    SAFETY_STOCK: 'safety_stock',
    REORDER_POINT: 'reorder_point',
    
    // 金額情報
    AVERAGE_COST: 'average_cost',
    INVENTORY_VALUE: 'inventory_value',
    
    // 日付情報
    LAST_TRANSACTION_DATE: 'last_transaction_date',
    LAST_STOCKTAKE_DATE: 'last_stocktake_date',
    
    // アラート
    ALERT_FLAG: 'alert_flag',
    
    // その他
    REMARKS: 'remarks',
    UPDATED_AT: 'updated_at'
  };

  // 在庫推移サマリーアプリ
  const PROJECTION_FIELDS = {
    // 複合キー
    SUMMARY_ID: 'summary_id',
    SUMMARY_DATE: 'summary_date',
    ITEM_CODE: 'item_code',
    WAREHOUSE: 'warehouse',           // 倉庫コード（ルックアップ）
    WAREHOUSE_NAME: 'warehouse_name', // 倉庫名（ルックアップコピー）
    LOCATION: 'location',
    
    // アイテム情報
    ITEM_NAME: 'item_name',
    UNIT: 'unit',
    
    // 実績在庫
    BEGINNING_QTY: 'beginning_qty',
    ACTUAL_RECEIVED_QTY: 'actual_received_qty',
    ACTUAL_ISSUED_QTY: 'actual_issued_qty',
    ENDING_QTY: 'ending_qty',
    
    // 予定在庫
    PLANNED_RECEIVED_QTY: 'planned_received_qty',
    PLANNED_ISSUED_QTY: 'planned_issued_qty',
    PROJECTED_ENDING_QTY: 'projected_ending_qty',
    
    // アラート
    ALERT_FLAG: 'alert_flag',
    
    // その他
    CREATED_AT: 'created_at',
    UPDATED_AT: 'updated_at'
  };

  // アイテムマスタ
  const ITEM_MASTER_FIELDS = {
    CODE: 'item_code',
    NAME: 'item_name',
    NAME_EN: 'item_name_en',
    CATEGORY: 'category',
    IS_INVENTORY: 'is_inventory',
    STANDARD_PRICE: 'standard_price',
    UNIT: 'unit',
    SPECIFICATION: 'specification',
    
    // 在庫管理関連
    SAFETY_STOCK: 'safety_stock',
    REORDER_POINT: 'reorder_point',
    LEAD_TIME_DAYS: 'lead_time_days',
    DEFAULT_WAREHOUSE: 'default_warehouse',
    DEFAULT_LOCATION: 'default_location',
    COST_METHOD: 'cost_method'
  };

  // 倉庫マスタ（追加）
  const WAREHOUSE_MASTER_FIELDS = {
    CODE: 'warehouse_code',     // 倉庫コード（TKY, OSK など）
    NAME: 'warehouse_name'      // 倉庫名（東京倉庫、大阪倉庫 など）
  };

  // 発注管理アプリ
  const PO_FIELDS = {
    // ヘッダー情報
    PO_NUMBER: 'po_number',
    ORDER_DATE: 'order_date',
    SUPPLIER: 'supplier',
    
    // 発注明細テーブル（po_items）
    PO_ITEMS: 'po_items',  // テーブルフィールドコード
    
    // 旧フィールド（互換性保持）
    IS_RECEIVED: 'is_received',
    RECEIVED_DATE: 'received_date',
    EXPECTED_RECEIVED_DATE: 'expected_received_date',
    LAST_RECEIVED_DATE: 'last_received_date'
  };

  // 発注明細テーブル（po_items）のフィールド
  const PO_ITEM_FIELDS = {
    // 基本情報
    ITEM_CODE: 'item_code',
    ITEM_NAME: 'item_name',
    
    // 数量管理
    QUANTITY: 'quantity',                // 発注数
    RECEIVED_QTY: 'received_qty',        // 納品済数（自動計算）
    REMAINING_QTY: 'remaining_qty',      // 発注残数（自動計算）
    
    // ステータス
    DELIVERY_STATUS: 'delivery_status',  // 納品ステータス（未納品/一部納品/完納）
    
    // 金額
    UNIT_PRICE: 'unit_price',
    AMOUNT: 'amount'
  };

  // =====================================================
  // 定数定義
  // =====================================================
  
  // 取引タイプ
  const TRANSACTION_TYPES = {
    RECEIVED: '入庫',
    ISSUED: '出庫',
    ADJUSTMENT: '棚卸調整',
    INITIAL: '初期在庫'
  };

  // ステータス
  const STATUSES = {
    PLANNED: '予定',
    CONFIRMED: '確定',
    CANCELLED: '取消'
  };

  // 参照タイプ
  const REFERENCE_TYPES = {
    PO_RECEIVED: '発注入庫',
    RETURN_RECEIVED: '返品入庫',
    PROJECT_ISSUED: '案件出庫',
    DEFECT_ISSUED: '不良品出庫',
    ADJUSTMENT: '棚卸調整',
    OTHER: 'その他'
  };

  // 棚卸差異理由
  const ADJUSTMENT_REASONS = {
    LOST: '紛失',
    DAMAGED: '破損',
    COUNT_ERROR: 'カウントミス',
    SYSTEM_ERROR: 'システムエラー',
    OTHER: 'その他'
  };

  // アラートフラグ
  const ALERT_FLAGS = {
    NORMAL: '正常',
    LOW: '在庫少',
    OUT: '在庫切れ',
    PLANNED_LOW: '予定在庫少',
    PLANNED_OUT: '予定在庫切れ'
  };

  // 在庫タイプ
  const INVENTORY_TYPES = {
    INVENTORY: '在庫品',
    NON_INVENTORY: '非在庫品'
  };

  // 入庫状況
  const RECEIVED_STATUSES = {
    NOT_RECEIVED: '未入庫',
    PARTIAL: '一部入庫',
    COMPLETED: '入庫完了'
  };

  // 納品ステータス（発注管理用）
  const DELIVERY_STATUSES = {
    NOT_DELIVERED: '未納品',       // received_qty = 0
    PARTIAL: '一部納品',           // 0 < received_qty < ordered_qty
    COMPLETED: '完納',              // received_qty = ordered_qty
    OVER_DELIVERED: '過納品'        // received_qty > ordered_qty
  };

  // 原価計算方法
  const COST_METHODS = {
    MOVING_AVERAGE: '移動平均法'
  };

  // =====================================================
  // UI 設定
  // =====================================================
  const UI = {
    // カラー
    COLORS: {
      PRIMARY: '#0066cc',
      SUCCESS: '#28a745',
      WARNING: '#ffc107',
      DANGER: '#dc3545',
      LIGHT: '#f8f9fa',
      DARK: '#343a40',
      BORDER: '#dee2e6'
    },
    
    // メッセージ
    MESSAGES: {
      // 成功
      SUCCESS_CREATE: 'レコードを作成しました',
      SUCCESS_UPDATE: '在庫残高を更新しました',
      SUCCESS_DELETE: 'レコードを削除しました',
      
      // エラー
      ERROR_ITEM_NOT_FOUND: 'アイテムが見つかりません',
      ERROR_BALANCE_NOT_FOUND: '在庫残高が見つかりません',
      ERROR_INSUFFICIENT_STOCK: '在庫不足です',
      ERROR_INVALID_QUANTITY: '数量が不正です',
      ERROR_INVALID_DATE: '日付が不正です',
      ERROR_DUPLICATE_ID: 'IDが重複しています',
      ERROR_NO_RESULTS: '検索結果が見つかりません',
      
      // 警告
      WARNING_LOW_STOCK: '在庫が安全在庫を下回っています',
      WARNING_OUT_OF_STOCK: '在庫切れです',
      WARNING_PLANNED_LOW: '予定在庫が安全在庫を下回る予定です',
      WARNING_PLANNED_OUT: '予定在庫切れになる予定です',
      
      // 確認
      CONFIRM_DELETE: '削除してもよろしいですか？',
      CONFIRM_CANCEL: 'キャンセルしてもよろしいですか？',
      CONFIRM_INSUFFICIENT_STOCK: '在庫不足ですが出庫を続行しますか？'
    },
    
    // ボタンテキスト
    BUTTON_TEXT: {
      ADD: '追加',
      SEARCH: '検索',
      SELECT: '選択',
      SAVE: '保存',
      CANCEL: 'キャンセル',
      DELETE: '削除',
      CLOSE: '閉じる',
      CONFIRM: '確定',
      BACK: '戻る'
    },
    
    // その他
    DATE_FORMAT: 'YYYY-MM-DD',
    DATETIME_FORMAT: 'YYYY-MM-DD HH:mm:ss',
    DECIMAL_PLACES: 2,
    MAX_ITEMS: 20,
    SEARCH_DELAY: 300  // ミリ秒
  };

  // =====================================================
  // グローバル公開
  // =====================================================
  window.INVENTORY_CONFIG = {
    APP_IDS: APP_IDS,
    FIELDS: {
      TRANSACTION: TRANSACTION_FIELDS,
      BALANCE: BALANCE_FIELDS,
      PROJECTION: PROJECTION_FIELDS,
      ITEM_MASTER: ITEM_MASTER_FIELDS,
      WAREHOUSE_MASTER: WAREHOUSE_MASTER_FIELDS,  // 追加
      PO: PO_FIELDS,
      PO_ITEM: PO_ITEM_FIELDS  // 発注明細テーブル用を追加
    },
    TRANSACTION_TYPES: TRANSACTION_TYPES,
    STATUSES: STATUSES,
    REFERENCE_TYPES: REFERENCE_TYPES,
    ADJUSTMENT_REASONS: ADJUSTMENT_REASONS,
    ALERT_FLAGS: ALERT_FLAGS,
    INVENTORY_TYPES: INVENTORY_TYPES,
    RECEIVED_STATUSES: RECEIVED_STATUSES,
    DELIVERY_STATUSES: DELIVERY_STATUSES,  // 発注管理用を追加
    COST_METHODS: COST_METHODS,
    UI: UI,
    
    // バージョン情報
    VERSION: '2.0.1',
    BUILD_DATE: '2026-02-15'
  };

  console.log('[INVENTORY] Config loaded - Version:', window.INVENTORY_CONFIG.VERSION);

})(kintone.$PLUGIN_ID);
