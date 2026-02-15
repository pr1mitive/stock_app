/**
 * kintone 在庫管理システム - ユーティリティ関数
 * 
 * 共通関数：日付フォーマット、フィールド取得、エラーハンドリングなど
 * 
 * @version 2.0
 * @date 2026-02-15
 * @requires inventory_config.js
 */

(function(PLUGIN_ID) {
  'use strict';

  // Config が読み込まれているか確認
  if (!window.INVENTORY_CONFIG) {
    console.error('[INVENTORY] Config not loaded. Please load inventory_config.js first.');
    return;
  }

  const CONFIG = window.INVENTORY_CONFIG;

  // =====================================================
  // 日付・時刻関連
  // =====================================================

  /**
   * 日付を指定形式の文字列に変換
   * @param {Date|string} date - 日付オブジェクトまたは文字列
   * @param {string} format - フォーマット (YYYY-MM-DD, YYYYMMDD, YYYY/MM/DD など)
   * @returns {string} フォーマットされた日付文字列
   */
  function formatDate(date, format = 'YYYY-MM-DD') {
    if (!date) return '';
    
    const d = (date instanceof Date) ? date : new Date(date);
    
    if (isNaN(d.getTime())) {
      console.error('[INVENTORY] Invalid date:', date);
      return '';
    }
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    
    return format
      .replace('YYYY', year)
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  }

  /**
   * 今日の日付を取得
   * @param {string} format - フォーマット
   * @returns {string} 今日の日付
   */
  function getToday(format = 'YYYY-MM-DD') {
    return formatDate(new Date(), format);
  }

  /**
   * 日付の加算
   * @param {Date|string} date - 基準日
   * @param {number} days - 加算日数（負の値で減算）
   * @returns {Date} 計算後の日付
   */
  function addDays(date, days) {
    const d = (date instanceof Date) ? new Date(date) : new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  /**
   * 2つの日付の差分（日数）を計算
   * @param {Date|string} date1 - 日付1
   * @param {Date|string} date2 - 日付2
   * @returns {number} 日数差分
   */
  function diffDays(date1, date2) {
    const d1 = (date1 instanceof Date) ? date1 : new Date(date1);
    const d2 = (date2 instanceof Date) ? date2 : new Date(date2);
    const diffTime = d1.getTime() - d2.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  // =====================================================
  // フィールド値取得
  // =====================================================

  /**
   * レコードからフィールド値を取得
   * @param {Object} record - kintone レコード
   * @param {string} fieldCode - フィールドコード
   * @returns {*} フィールド値
   */
  function getFieldValue(record, fieldCode) {
    if (!record || !fieldCode) return '';
    
    const field = record[fieldCode];
    if (!field) return '';
    
    // フィールドタイプに応じて値を取得
    if (field.type === 'SUBTABLE') {
      return field.value || [];
    } else if (field.type === 'USER_SELECT' || field.type === 'CREATOR' || field.type === 'MODIFIER') {
      return field.value && field.value.length > 0 ? field.value[0].code : '';
    } else if (field.type === 'CHECK_BOX' || field.type === 'MULTI_SELECT') {
      return field.value || [];
    } else {
      return field.value || '';
    }
  }

  /**
   * レコードにフィールド値を設定
   * @param {Object} record - kintone レコード
   * @param {string} fieldCode - フィールドコード
   * @param {*} value - 設定する値
   */
  function setFieldValue(record, fieldCode, value) {
    if (!record || !fieldCode) return;
    
    if (!record[fieldCode]) {
      record[fieldCode] = { value: value };
    } else {
      record[fieldCode].value = value;
    }
  }

  /**
   * 数値フィールドの値を取得（数値型で返す）
   * @param {Object} record - kintone レコード
   * @param {string} fieldCode - フィールドコード
   * @returns {number} 数値
   */
  function getNumberValue(record, fieldCode) {
    const value = getFieldValue(record, fieldCode);
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  // =====================================================
  // kintone API ヘルパー
  // =====================================================

  /**
   * レコードを取得（単一）
   * @param {number} appId - アプリID
   * @param {number} recordId - レコード番号
   * @returns {Promise<Object>} レコードオブジェクト
   */
  async function getRecord(appId, recordId) {
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/record', true), 'GET', {
        app: appId,
        id: recordId
      });
      return resp.record;
    } catch (error) {
      console.error('[INVENTORY] Error getting record:', error);
      throw error;
    }
  }

  /**
   * レコードを取得（複数）
   * @param {number} appId - アプリID
   * @param {string} query - クエリ文字列
   * @param {Array<string>} fields - 取得するフィールド（省略時は全フィールド）
   * @returns {Promise<Array>} レコード配列
   */
  async function getRecords(appId, query = '', fields = []) {
    try {
      const params = {
        app: appId,
        query: query
      };
      
      if (fields && fields.length > 0) {
        params.fields = fields;
      }
      
      const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', params);
      return resp.records;
    } catch (error) {
      console.error('[INVENTORY] Error getting records:', error);
      throw error;
    }
  }

  /**
   * レコードを作成
   * @param {number} appId - アプリID
   * @param {Object} record - レコードオブジェクト
   * @returns {Promise<Object>} 作成結果（id, revision）
   */
  async function createRecord(appId, record) {
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
        app: appId,
        record: record
      });
      return resp;
    } catch (error) {
      console.error('[INVENTORY] Error creating record:', error);
      throw error;
    }
  }

  /**
   * レコードを更新
   * @param {number} appId - アプリID
   * @param {number} recordId - レコード番号
   * @param {Object} record - 更新するフィールド
   * @param {number} revision - リビジョン番号（省略可）
   * @returns {Promise<Object>} 更新結果（revision）
   */
  async function updateRecord(appId, recordId, record, revision = -1) {
    try {
      const params = {
        app: appId,
        id: recordId,
        record: record
      };
      
      if (revision >= 0) {
        params.revision = revision;
      }
      
      const resp = await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', params);
      return resp;
    } catch (error) {
      console.error('[INVENTORY] Error updating record:', error);
      throw error;
    }
  }

  /**
   * レコードを削除
   * @param {number} appId - アプリID
   * @param {Array<number>} recordIds - レコード番号の配列
   * @returns {Promise<Object>} 削除結果
   */
  async function deleteRecords(appId, recordIds) {
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'DELETE', {
        app: appId,
        ids: recordIds
      });
      return resp;
    } catch (error) {
      console.error('[INVENTORY] Error deleting records:', error);
      throw error;
    }
  }

  /**
   * 一括レコード取得（500件以上に対応）
   * @param {number} appId - アプリID
   * @param {string} query - クエリ文字列
   * @param {Array<string>} fields - 取得するフィールド
   * @returns {Promise<Array>} 全レコード配列
   */
  async function getAllRecords(appId, query = '', fields = []) {
    const allRecords = [];
    const limit = 500;
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const queryWithLimit = `${query} limit ${limit} offset ${offset}`;
      const records = await getRecords(appId, queryWithLimit, fields);
      
      allRecords.push(...records);
      
      if (records.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }
    
    return allRecords;
  }

  // =====================================================
  // 数値・文字列処理
  // =====================================================

  /**
   * 数値を指定桁数でゼロ埋め
   * @param {number} num - 数値
   * @param {number} length - 桁数
   * @returns {string} ゼロ埋めされた文字列
   */
  function padZero(num, length = 3) {
    return String(num).padStart(length, '0');
  }

  /**
   * 数値を小数点以下指定桁数で丸める
   * @param {number} num - 数値
   * @param {number} decimals - 小数点以下桁数
   * @returns {number} 丸められた数値
   */
  function roundDecimal(num, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  }

  /**
   * HTMLエスケープ
   * @param {string} str - 文字列
   * @returns {string} エスケープされた文字列
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // =====================================================
  // UI関連
  // =====================================================

  /**
   * アラート表示
   * @param {string} message - メッセージ
   * @param {string} type - タイプ (success, warning, error, info)
   */
  function showAlert(message, type = 'info') {
    const colors = {
      success: CONFIG.UI.COLORS.SUCCESS,
      warning: CONFIG.UI.COLORS.WARNING,
      error: CONFIG.UI.COLORS.DANGER,
      info: CONFIG.UI.COLORS.PRIMARY
    };
    
    const color = colors[type] || colors.info;
    
    // kintone の通知領域に表示
    const alertDiv = document.createElement('div');
    alertDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      background-color: ${color};
      color: white;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 10000;
      max-width: 400px;
      font-size: 14px;
    `;
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);
    
    // 3秒後に自動削除
    setTimeout(() => {
      alertDiv.style.opacity = '0';
      alertDiv.style.transition = 'opacity 0.5s';
      setTimeout(() => {
        if (alertDiv.parentNode) {
          alertDiv.parentNode.removeChild(alertDiv);
        }
      }, 500);
    }, 3000);
  }

  /**
   * ローディング表示
   */
  function showLoading() {
    if (document.getElementById('inventory-loading')) return;
    
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'inventory-loading';
    loadingDiv.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    `;
    
    loadingDiv.innerHTML = `
      <div style="
        background: white;
        padding: 30px 40px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        text-align: center;
      ">
        <div style="
          width: 40px;
          height: 40px;
          border: 4px solid ${CONFIG.UI.COLORS.LIGHT};
          border-top-color: ${CONFIG.UI.COLORS.PRIMARY};
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 15px;
        "></div>
        <div style="color: ${CONFIG.UI.COLORS.DARK}; font-size: 14px;">処理中...</div>
      </div>
    `;
    
    // アニメーション追加
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(loadingDiv);
  }

  /**
   * ローディング非表示
   */
  function hideLoading() {
    const loadingDiv = document.getElementById('inventory-loading');
    if (loadingDiv && loadingDiv.parentNode) {
      loadingDiv.parentNode.removeChild(loadingDiv);
    }
  }

  // =====================================================
  // ログ出力
  // =====================================================

  /**
   * ログ出力（info）
   * @param {string} message - メッセージ
   * @param {*} data - データ（省略可）
   */
  function log(message, data) {
    console.log(`[INVENTORY] ${message}`, data !== undefined ? data : '');
  }

  /**
   * エラーログ出力
   * @param {string} message - メッセージ
   * @param {*} error - エラーオブジェクト
   */
  function error(message, error) {
    console.error(`[INVENTORY] ${message}`, error || '');
  }

  /**
   * 警告ログ出力
   * @param {string} message - メッセージ
   * @param {*} data - データ（省略可）
   */
  function warn(message, data) {
    console.warn(`[INVENTORY] ${message}`, data !== undefined ? data : '');
  }

  /**
   * 指定ミリ秒待機（非同期）
   * @param {number} ms - 待機時間（ミリ秒）
   * @returns {Promise} Promise
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =====================================================
  // バリデーション
  // =====================================================

  /**
   * 必須チェック
   * @param {*} value - 値
   * @returns {boolean} true: OK, false: NG
   */
  function isRequired(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }

  /**
   * 数値チェック
   * @param {*} value - 値
   * @returns {boolean} true: 数値, false: 数値でない
   */
  function isNumber(value) {
    return !isNaN(parseFloat(value)) && isFinite(value);
  }

  /**
   * 日付チェック
   * @param {*} value - 値
   * @returns {boolean} true: 日付, false: 日付でない
   */
  function isDate(value) {
    const d = new Date(value);
    return !isNaN(d.getTime());
  }

  /**
   * 正の数チェック
   * @param {*} value - 値
   * @returns {boolean} true: 正の数, false: 0以下
   */
  function isPositive(value) {
    return isNumber(value) && parseFloat(value) > 0;
  }

  // =====================================================
  // グローバル公開
  // =====================================================
  window.InventoryUtils = {
    // 日付・時刻
    formatDate: formatDate,
    getToday: getToday,
    addDays: addDays,
    diffDays: diffDays,
    
    // フィールド値
    getFieldValue: getFieldValue,
    setFieldValue: setFieldValue,
    getNumberValue: getNumberValue,
    
    // kintone API
    getRecord: getRecord,
    getRecords: getRecords,
    createRecord: createRecord,
    updateRecord: updateRecord,
    deleteRecords: deleteRecords,
    getAllRecords: getAllRecords,
    
    // 数値・文字列
    padZero: padZero,
    roundDecimal: roundDecimal,
    escapeHtml: escapeHtml,
    
    // UI
    showAlert: showAlert,
    showLoading: showLoading,
    hideLoading: hideLoading,
    
    // ログ
    log: log,
    error: error,
    warn: warn,
    
    // バリデーション
    isRequired: isRequired,
    isNumber: isNumber,
    isDate: isDate,
    isPositive: isPositive,
    
    // 非同期処理
    sleep: sleep
  };

  window.InventoryUtils.VERSION = '2.0';
  
  log('Utils loaded - Version: 2.0');

})(kintone.$PLUGIN_ID);
