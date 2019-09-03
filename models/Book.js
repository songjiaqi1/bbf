
/**
 * @fileoverview 实现 Books的数据类型
 * @author sjq
 */

 const SafeRequest = require('../utils/safeRequst');

class Books {

  /**
   * 
   * @param {Object} app koa 的执行上下文
   */
  constructor(app) {
    this.app = app;  
  }

  /**
   * @param {*} options 获取数据的相关参数
   * 
   * @example 
   */
  getList() {
    let safeRequst = new SafeRequest('books');

    return safeRequst.get();
  }
}


module.exports = Books
