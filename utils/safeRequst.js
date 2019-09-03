const config = require('../config/index');
const axiox = require('axios');

class SafeRequst {
  constructor(url) {
    this.url = url;
    this.baseUrl = config.baseUrl;
  }

  get(params = {}) {
    let result = {
      code: 0,
      message: '',
      data: []
    }

    return new Promise((resolve, reject) => {
      axiox.get(this.baseUrl + this.url, {
        params  
      }).then((response) => {
        if (response.status === 200) {
          const data = response.data;
          result.data = data;
          resolve(result);
        } else {
          result.code = -1;
          result.message = '后台请求出错';
          reject(result);
        }
      }).catch((error) => {
        result.code = 1;
        result.message = error;
        reject(result);
      })
    });
  }
}

module.exports = SafeRequst;