module.exports = function (options) {
  const originalExternals = options.externals;

  return {
    ...options,
    externals: [
      function (data, callback) {
        const { request } = data;
        // Bundle pure-TS workspace packages; externalize those with native binaries
        if (request === '@school-manager/types') {
          return callback();
        }
        // Delegate to NestJS CLI's default externals for everything else
        if (Array.isArray(originalExternals)) {
          for (const ext of originalExternals) {
            if (typeof ext === 'function') {
              return ext(data, callback);
            }
          }
        }
        callback();
      },
    ],
  };
};
