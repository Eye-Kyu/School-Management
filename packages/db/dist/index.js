'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const client = require('@prisma/client');
Object.keys(client).forEach(function (key) {
  if (key === 'default' || key === '__esModule') return;
  if (Object.prototype.hasOwnProperty.call(exports, key)) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () { return client[key]; },
  });
});
