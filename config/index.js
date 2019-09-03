const { extend } = require('lodash');
const { join } = require('path');

let config = {
  viewPath: join(__dirname, '..', 'views'),
  staticPath: join(__dirname, '..', 'assets')
};

if (process.env.NODE_ENV === 'development') {
  const localConfig = {
    port: 8082,
    baseUrl: 'http://localhost/db/basic/web/index.php?r='
  }
  config = extend(config, localConfig); 
}

if (process.env.NODE_ENV === 'product') {
  productConfig = { 
    port: 80,
    baseUrl: ''
  };
  config = extend(config, productConfig);
}

module.exports = config;