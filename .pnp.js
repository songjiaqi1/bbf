#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = new Map();
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?!\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `),
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["axios", new Map([
    ["0.19.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-axios-0.19.0-8e09bff3d9122e133f7b8101c8fbdd00ed3d2ab8/node_modules/axios/"),
      packageDependencies: new Map([
        ["follow-redirects", "1.5.10"],
        ["is-buffer", "2.0.3"],
        ["axios", "0.19.0"],
      ]),
    }],
  ])],
  ["follow-redirects", new Map([
    ["1.5.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-follow-redirects-1.5.10-7b7a9f9aea2fdff36786a94ff643ed07f4ff5e2a/node_modules/follow-redirects/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["follow-redirects", "1.5.10"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "3.1.0"],
      ]),
    }],
    ["3.2.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-debug-3.2.6-e83d17de16d8a7efb7717edbe5fb10135eee629b/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
        ["debug", "3.2.6"],
      ]),
    }],
    ["2.6.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "2.6.9"],
      ]),
    }],
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
        ["debug", "4.1.1"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
      ]),
    }],
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
      ]),
    }],
  ])],
  ["is-buffer", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-buffer-2.0.3-4ecf3fcf749cbd1e472689e109ac66261a25e725/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "2.0.3"],
      ]),
    }],
    ["1.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
      ]),
    }],
  ])],
  ["co", new Map([
    ["4.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-co-4.6.0-6ea6bdf3d853ae54ccb8e47bfa0bf3f9031fb184/node_modules/co/"),
      packageDependencies: new Map([
        ["co", "4.6.0"],
      ]),
    }],
  ])],
  ["cross-env", new Map([
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cross-env-5.2.0-6ecd4c015d5773e614039ee529076669b9d126f2/node_modules/cross-env/"),
      packageDependencies: new Map([
        ["cross-spawn", "6.0.5"],
        ["is-windows", "1.0.2"],
        ["cross-env", "5.2.0"],
      ]),
    }],
  ])],
  ["cross-spawn", new Map([
    ["6.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
        ["path-key", "2.0.1"],
        ["semver", "5.7.1"],
        ["shebang-command", "1.2.0"],
        ["which", "1.3.1"],
        ["cross-spawn", "6.0.5"],
      ]),
    }],
  ])],
  ["nice-try", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366/node_modules/nice-try/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
      ]),
    }],
  ])],
  ["path-key", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40/node_modules/path-key/"),
      packageDependencies: new Map([
        ["path-key", "2.0.1"],
      ]),
    }],
  ])],
  ["semver", new Map([
    ["5.7.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "5.7.1"],
      ]),
    }],
  ])],
  ["shebang-command", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea/node_modules/shebang-command/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
        ["shebang-command", "1.2.0"],
      ]),
    }],
  ])],
  ["shebang-regex", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3/node_modules/shebang-regex/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
      ]),
    }],
  ])],
  ["which", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "1.3.1"],
      ]),
    }],
  ])],
  ["isexe", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
      ]),
    }],
  ])],
  ["is-windows", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/"),
      packageDependencies: new Map([
        ["is-windows", "1.0.2"],
      ]),
    }],
  ])],
  ["jsdoc", new Map([
    ["3.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jsdoc-3.6.3-dccea97d0e62d63d306b8b3ed1527173b5e2190d/node_modules/jsdoc/"),
      packageDependencies: new Map([
        ["@babel/parser", "7.5.5"],
        ["bluebird", "3.5.5"],
        ["catharsis", "0.8.11"],
        ["escape-string-regexp", "2.0.0"],
        ["js2xmlparser", "4.0.0"],
        ["klaw", "3.0.0"],
        ["markdown-it", "8.4.2"],
        ["markdown-it-anchor", "5.2.4"],
        ["marked", "0.7.0"],
        ["mkdirp", "0.5.1"],
        ["requizzle", "0.2.3"],
        ["strip-json-comments", "3.0.1"],
        ["taffydb", "2.6.2"],
        ["underscore", "1.9.1"],
        ["jsdoc", "3.6.3"],
      ]),
    }],
  ])],
  ["@babel/parser", new Map([
    ["7.5.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-@babel-parser-7.5.5-02f077ac8817d3df4a832ef59de67565e71cca4b/node_modules/@babel/parser/"),
      packageDependencies: new Map([
        ["@babel/parser", "7.5.5"],
      ]),
    }],
  ])],
  ["bluebird", new Map([
    ["3.5.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-bluebird-3.5.5-a8d0afd73251effbbd5fe384a77d73003c17a71f/node_modules/bluebird/"),
      packageDependencies: new Map([
        ["bluebird", "3.5.5"],
      ]),
    }],
  ])],
  ["catharsis", new Map([
    ["0.8.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-catharsis-0.8.11-d0eb3d2b82b7da7a3ce2efb1a7b00becc6643468/node_modules/catharsis/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
        ["catharsis", "0.8.11"],
      ]),
    }],
  ])],
  ["lodash", new Map([
    ["4.17.15", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548/node_modules/lodash/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-escape-string-regexp-2.0.0-a30304e99daa32e23b2fd20f51babd07cffca344/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "2.0.0"],
      ]),
    }],
  ])],
  ["js2xmlparser", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-js2xmlparser-4.0.0-ae14cc711b2892083eed6e219fbc993d858bc3a5/node_modules/js2xmlparser/"),
      packageDependencies: new Map([
        ["xmlcreate", "2.0.1"],
        ["js2xmlparser", "4.0.0"],
      ]),
    }],
  ])],
  ["xmlcreate", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-xmlcreate-2.0.1-2ec38bd7b708d213fd1a90e2431c4af9c09f6a52/node_modules/xmlcreate/"),
      packageDependencies: new Map([
        ["xmlcreate", "2.0.1"],
      ]),
    }],
  ])],
  ["klaw", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-klaw-3.0.0-b11bec9cf2492f06756d6e809ab73a2910259146/node_modules/klaw/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["klaw", "3.0.0"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
      ]),
    }],
  ])],
  ["markdown-it", new Map([
    ["8.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-markdown-it-8.4.2-386f98998dc15a37722aa7722084f4020bdd9b54/node_modules/markdown-it/"),
      packageDependencies: new Map([
        ["argparse", "1.0.10"],
        ["entities", "1.1.2"],
        ["linkify-it", "2.2.0"],
        ["mdurl", "1.0.1"],
        ["uc.micro", "1.0.6"],
        ["markdown-it", "8.4.2"],
      ]),
    }],
  ])],
  ["argparse", new Map([
    ["1.0.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
        ["argparse", "1.0.10"],
      ]),
    }],
  ])],
  ["sprintf-js", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
      ]),
    }],
  ])],
  ["entities", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-entities-1.1.2-bdfa735299664dfafd34529ed4f8522a275fea56/node_modules/entities/"),
      packageDependencies: new Map([
        ["entities", "1.1.2"],
      ]),
    }],
  ])],
  ["linkify-it", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-linkify-it-2.2.0-e3b54697e78bf915c70a38acd78fd09e0058b1cf/node_modules/linkify-it/"),
      packageDependencies: new Map([
        ["uc.micro", "1.0.6"],
        ["linkify-it", "2.2.0"],
      ]),
    }],
  ])],
  ["uc.micro", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-uc-micro-1.0.6-9c411a802a409a91fc6cf74081baba34b24499ac/node_modules/uc.micro/"),
      packageDependencies: new Map([
        ["uc.micro", "1.0.6"],
      ]),
    }],
  ])],
  ["mdurl", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mdurl-1.0.1-fe85b2ec75a59037f2adfec100fd6c601761152e/node_modules/mdurl/"),
      packageDependencies: new Map([
        ["mdurl", "1.0.1"],
      ]),
    }],
  ])],
  ["markdown-it-anchor", new Map([
    ["5.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-markdown-it-anchor-5.2.4-d39306fe4c199705b4479d3036842cf34dcba24f/node_modules/markdown-it-anchor/"),
      packageDependencies: new Map([
        ["markdown-it", "8.4.2"],
        ["markdown-it-anchor", "5.2.4"],
      ]),
    }],
  ])],
  ["marked", new Map([
    ["0.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-marked-0.7.0-b64201f051d271b1edc10a04d1ae9b74bb8e5c0e/node_modules/marked/"),
      packageDependencies: new Map([
        ["marked", "0.7.0"],
      ]),
    }],
  ])],
  ["mkdirp", new Map([
    ["0.5.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
        ["mkdirp", "0.5.1"],
      ]),
    }],
  ])],
  ["minimist", new Map([
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
      ]),
    }],
    ["0.0.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-minimist-0.0.10-de3f98543dbf96082be48ad1a0c7cda836301dcf/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.10"],
      ]),
    }],
  ])],
  ["requizzle", new Map([
    ["0.2.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-requizzle-0.2.3-4675c90aacafb2c036bd39ba2daa4a1cb777fded/node_modules/requizzle/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
        ["requizzle", "0.2.3"],
      ]),
    }],
  ])],
  ["strip-json-comments", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-strip-json-comments-3.0.1-85713975a91fb87bf1b305cca77395e40d2a64a7/node_modules/strip-json-comments/"),
      packageDependencies: new Map([
        ["strip-json-comments", "3.0.1"],
      ]),
    }],
  ])],
  ["taffydb", new Map([
    ["2.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-taffydb-2.6.2-7cbcb64b5a141b6a2efc2c5d2c67b4e150b2a268/node_modules/taffydb/"),
      packageDependencies: new Map([
        ["taffydb", "2.6.2"],
      ]),
    }],
  ])],
  ["underscore", new Map([
    ["1.9.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-underscore-1.9.1-06dce34a0e68a7babc29b365b8e74b8925203961/node_modules/underscore/"),
      packageDependencies: new Map([
        ["underscore", "1.9.1"],
      ]),
    }],
  ])],
  ["koa", new Map([
    ["2.8.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-koa-2.8.1-98e13b267ab8a1868f015a4b41b5a52e31457ce5/node_modules/koa/"),
      packageDependencies: new Map([
        ["accepts", "1.3.7"],
        ["cache-content-type", "1.0.1"],
        ["content-disposition", "0.5.3"],
        ["content-type", "1.0.4"],
        ["cookies", "0.7.3"],
        ["debug", "3.1.0"],
        ["delegates", "1.0.0"],
        ["depd", "1.1.2"],
        ["destroy", "1.0.4"],
        ["error-inject", "1.0.0"],
        ["escape-html", "1.0.3"],
        ["fresh", "0.5.2"],
        ["http-assert", "1.4.1"],
        ["http-errors", "1.7.3"],
        ["is-generator-function", "1.0.7"],
        ["koa-compose", "4.1.0"],
        ["koa-convert", "1.2.0"],
        ["koa-is-json", "1.0.0"],
        ["on-finished", "2.3.0"],
        ["only", "0.0.2"],
        ["parseurl", "1.3.3"],
        ["statuses", "1.5.0"],
        ["type-is", "1.6.18"],
        ["vary", "1.1.2"],
        ["koa", "2.8.1"],
      ]),
    }],
  ])],
  ["accepts", new Map([
    ["1.3.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-accepts-1.3.7-531bc726517a3b2b41f850021c6cc15eaab507cd/node_modules/accepts/"),
      packageDependencies: new Map([
        ["mime-types", "2.1.24"],
        ["negotiator", "0.6.2"],
        ["accepts", "1.3.7"],
      ]),
    }],
  ])],
  ["mime-types", new Map([
    ["2.1.24", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mime-types-2.1.24-b6f8d0b3e951efb77dedeca194cff6d16f676f81/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-db", "1.40.0"],
        ["mime-types", "2.1.24"],
      ]),
    }],
  ])],
  ["mime-db", new Map([
    ["1.40.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mime-db-1.40.0-a65057e998db090f732a68f6c276d387d4126c32/node_modules/mime-db/"),
      packageDependencies: new Map([
        ["mime-db", "1.40.0"],
      ]),
    }],
  ])],
  ["negotiator", new Map([
    ["0.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-negotiator-0.6.2-feacf7ccf525a77ae9634436a64883ffeca346fb/node_modules/negotiator/"),
      packageDependencies: new Map([
        ["negotiator", "0.6.2"],
      ]),
    }],
  ])],
  ["cache-content-type", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cache-content-type-1.0.1-035cde2b08ee2129f4a8315ea8f00a00dba1453c/node_modules/cache-content-type/"),
      packageDependencies: new Map([
        ["mime-types", "2.1.24"],
        ["ylru", "1.2.1"],
        ["cache-content-type", "1.0.1"],
      ]),
    }],
  ])],
  ["ylru", new Map([
    ["1.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ylru-1.2.1-f576b63341547989c1de7ba288760923b27fe84f/node_modules/ylru/"),
      packageDependencies: new Map([
        ["ylru", "1.2.1"],
      ]),
    }],
  ])],
  ["content-disposition", new Map([
    ["0.5.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-content-disposition-0.5.3-e130caf7e7279087c5616c2007d0485698984fbd/node_modules/content-disposition/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["content-disposition", "0.5.3"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
      ]),
    }],
  ])],
  ["content-type", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-content-type-1.0.4-e138cc75e040c727b1966fe5e5f8c9aee256fe3b/node_modules/content-type/"),
      packageDependencies: new Map([
        ["content-type", "1.0.4"],
      ]),
    }],
  ])],
  ["cookies", new Map([
    ["0.7.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cookies-0.7.3-7912ce21fbf2e8c2da70cf1c3f351aecf59dadfa/node_modules/cookies/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
        ["keygrip", "1.0.3"],
        ["cookies", "0.7.3"],
      ]),
    }],
  ])],
  ["depd", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9/node_modules/depd/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
      ]),
    }],
  ])],
  ["keygrip", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-keygrip-1.0.3-399d709f0aed2bab0a059e0cdd3a5023a053e1dc/node_modules/keygrip/"),
      packageDependencies: new Map([
        ["keygrip", "1.0.3"],
      ]),
    }],
  ])],
  ["delegates", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-delegates-1.0.0-84c6e159b81904fdca59a0ef44cd870d31250f9a/node_modules/delegates/"),
      packageDependencies: new Map([
        ["delegates", "1.0.0"],
      ]),
    }],
  ])],
  ["destroy", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-destroy-1.0.4-978857442c44749e4206613e37946205826abd80/node_modules/destroy/"),
      packageDependencies: new Map([
        ["destroy", "1.0.4"],
      ]),
    }],
  ])],
  ["error-inject", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-error-inject-1.0.0-e2b3d91b54aed672f309d950d154850fa11d4f37/node_modules/error-inject/"),
      packageDependencies: new Map([
        ["error-inject", "1.0.0"],
      ]),
    }],
  ])],
  ["escape-html", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-escape-html-1.0.3-0258eae4d3d0c0974de1c169188ef0051d1d1988/node_modules/escape-html/"),
      packageDependencies: new Map([
        ["escape-html", "1.0.3"],
      ]),
    }],
  ])],
  ["fresh", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fresh-0.5.2-3d8cadd90d976569fa835ab1f8e4b23a105605a7/node_modules/fresh/"),
      packageDependencies: new Map([
        ["fresh", "0.5.2"],
      ]),
    }],
  ])],
  ["http-assert", new Map([
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-http-assert-1.4.1-c5f725d677aa7e873ef736199b89686cceb37878/node_modules/http-assert/"),
      packageDependencies: new Map([
        ["deep-equal", "1.0.1"],
        ["http-errors", "1.7.3"],
        ["http-assert", "1.4.1"],
      ]),
    }],
  ])],
  ["deep-equal", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-deep-equal-1.0.1-f5d260292b660e084eff4cdbc9f08ad3247448b5/node_modules/deep-equal/"),
      packageDependencies: new Map([
        ["deep-equal", "1.0.1"],
      ]),
    }],
  ])],
  ["http-errors", new Map([
    ["1.7.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-http-errors-1.7.3-6c619e4f9c60308c38519498c14fbb10aacebb06/node_modules/http-errors/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
        ["inherits", "2.0.4"],
        ["setprototypeof", "1.1.1"],
        ["statuses", "1.5.0"],
        ["toidentifier", "1.0.0"],
        ["http-errors", "1.7.3"],
      ]),
    }],
    ["1.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-http-errors-1.6.3-8b55680bb4be283a0b5bf4ea2e38580be1d9320d/node_modules/http-errors/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
        ["inherits", "2.0.3"],
        ["setprototypeof", "1.1.0"],
        ["statuses", "1.5.0"],
        ["http-errors", "1.6.3"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
      ]),
    }],
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.3"],
      ]),
    }],
  ])],
  ["setprototypeof", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-setprototypeof-1.1.1-7e95acb24aa92f5885e0abef5ba131330d4ae683/node_modules/setprototypeof/"),
      packageDependencies: new Map([
        ["setprototypeof", "1.1.1"],
      ]),
    }],
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-setprototypeof-1.1.0-d0bd85536887b6fe7c0d818cb962d9d91c54e656/node_modules/setprototypeof/"),
      packageDependencies: new Map([
        ["setprototypeof", "1.1.0"],
      ]),
    }],
  ])],
  ["statuses", new Map([
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "1.5.0"],
      ]),
    }],
  ])],
  ["toidentifier", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-toidentifier-1.0.0-7e1be3470f1e77948bc43d94a3c8f4d7752ba553/node_modules/toidentifier/"),
      packageDependencies: new Map([
        ["toidentifier", "1.0.0"],
      ]),
    }],
  ])],
  ["is-generator-function", new Map([
    ["1.0.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-is-generator-function-1.0.7-d2132e529bb0000a7f80794d4bdf5cd5e5813522/node_modules/is-generator-function/"),
      packageDependencies: new Map([
        ["is-generator-function", "1.0.7"],
      ]),
    }],
  ])],
  ["koa-compose", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-koa-compose-4.1.0-507306b9371901db41121c812e923d0d67d3e877/node_modules/koa-compose/"),
      packageDependencies: new Map([
        ["koa-compose", "4.1.0"],
      ]),
    }],
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-koa-compose-3.2.1-a85ccb40b7d986d8e5a345b3a1ace8eabcf54de7/node_modules/koa-compose/"),
      packageDependencies: new Map([
        ["any-promise", "1.3.0"],
        ["koa-compose", "3.2.1"],
      ]),
    }],
  ])],
  ["koa-convert", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-koa-convert-1.2.0-da40875df49de0539098d1700b50820cebcd21d0/node_modules/koa-convert/"),
      packageDependencies: new Map([
        ["co", "4.6.0"],
        ["koa-compose", "3.2.1"],
        ["koa-convert", "1.2.0"],
      ]),
    }],
  ])],
  ["any-promise", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-any-promise-1.3.0-abc6afeedcea52e809cdc0376aed3ce39635d17f/node_modules/any-promise/"),
      packageDependencies: new Map([
        ["any-promise", "1.3.0"],
      ]),
    }],
  ])],
  ["koa-is-json", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-koa-is-json-1.0.0-273c07edcdcb8df6a2c1ab7d59ee76491451ec14/node_modules/koa-is-json/"),
      packageDependencies: new Map([
        ["koa-is-json", "1.0.0"],
      ]),
    }],
  ])],
  ["on-finished", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-on-finished-2.3.0-20f1336481b083cd75337992a16971aa2d906947/node_modules/on-finished/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
        ["on-finished", "2.3.0"],
      ]),
    }],
  ])],
  ["ee-first", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d/node_modules/ee-first/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
      ]),
    }],
  ])],
  ["only", new Map([
    ["0.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-only-0.0.2-2afde84d03e50b9a8edc444e30610a70295edfb4/node_modules/only/"),
      packageDependencies: new Map([
        ["only", "0.0.2"],
      ]),
    }],
  ])],
  ["parseurl", new Map([
    ["1.3.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-parseurl-1.3.3-9da19e7bee8d12dff0513ed5b76957793bc2e8d4/node_modules/parseurl/"),
      packageDependencies: new Map([
        ["parseurl", "1.3.3"],
      ]),
    }],
  ])],
  ["type-is", new Map([
    ["1.6.18", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-type-is-1.6.18-4e552cd05df09467dcbc4ef739de89f2cf37c131/node_modules/type-is/"),
      packageDependencies: new Map([
        ["media-typer", "0.3.0"],
        ["mime-types", "2.1.24"],
        ["type-is", "1.6.18"],
      ]),
    }],
  ])],
  ["media-typer", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-media-typer-0.3.0-8710d7af0aa626f8fffa1ce00168545263255748/node_modules/media-typer/"),
      packageDependencies: new Map([
        ["media-typer", "0.3.0"],
      ]),
    }],
  ])],
  ["vary", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-vary-1.1.2-2299f02c6ded30d4a5961b0b9f74524a18f634fc/node_modules/vary/"),
      packageDependencies: new Map([
        ["vary", "1.1.2"],
      ]),
    }],
  ])],
  ["koa-simple-router", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-koa-simple-router-0.2.0-29ba92f187107d6838c77ac24b7a473a151c7a94/node_modules/koa-simple-router/"),
      packageDependencies: new Map([
        ["koa-compose", "3.2.1"],
        ["methods", "1.1.2"],
        ["path-to-regexp", "1.7.0"],
        ["koa-simple-router", "0.2.0"],
      ]),
    }],
  ])],
  ["methods", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-methods-1.1.2-5529a4d67654134edcc5266656835b0f851afcee/node_modules/methods/"),
      packageDependencies: new Map([
        ["methods", "1.1.2"],
      ]),
    }],
  ])],
  ["path-to-regexp", new Map([
    ["1.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-path-to-regexp-1.7.0-59fde0f435badacba103a84e9d3bc64e96b9937d/node_modules/path-to-regexp/"),
      packageDependencies: new Map([
        ["isarray", "0.0.1"],
        ["path-to-regexp", "1.7.0"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-isarray-0.0.1-8a18acfca9a8f4177e09abfc6038939b05d1eedf/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "0.0.1"],
      ]),
    }],
  ])],
  ["koa-static", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-koa-static-5.0.0-5e92fc96b537ad5219f425319c95b64772776943/node_modules/koa-static/"),
      packageDependencies: new Map([
        ["debug", "3.2.6"],
        ["koa-send", "5.0.0"],
        ["koa-static", "5.0.0"],
      ]),
    }],
  ])],
  ["koa-send", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-koa-send-5.0.0-5e8441e07ef55737734d7ced25b842e50646e7eb/node_modules/koa-send/"),
      packageDependencies: new Map([
        ["debug", "3.2.6"],
        ["http-errors", "1.7.3"],
        ["mz", "2.7.0"],
        ["resolve-path", "1.4.0"],
        ["koa-send", "5.0.0"],
      ]),
    }],
  ])],
  ["mz", new Map([
    ["2.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-mz-2.7.0-95008057a56cafadc2bc63dde7f9ff6955948e32/node_modules/mz/"),
      packageDependencies: new Map([
        ["any-promise", "1.3.0"],
        ["object-assign", "4.1.1"],
        ["thenify-all", "1.6.0"],
        ["mz", "2.7.0"],
      ]),
    }],
  ])],
  ["object-assign", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-object-assign-4.1.1-2109adc7965887cfc05cbbd442cac8bfbb360863/node_modules/object-assign/"),
      packageDependencies: new Map([
        ["object-assign", "4.1.1"],
      ]),
    }],
  ])],
  ["thenify-all", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-thenify-all-1.6.0-1a1918d402d8fc3f98fbf234db0bcc8cc10e9726/node_modules/thenify-all/"),
      packageDependencies: new Map([
        ["thenify", "3.3.0"],
        ["thenify-all", "1.6.0"],
      ]),
    }],
  ])],
  ["thenify", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-thenify-3.3.0-e69e38a1babe969b0108207978b9f62b88604839/node_modules/thenify/"),
      packageDependencies: new Map([
        ["any-promise", "1.3.0"],
        ["thenify", "3.3.0"],
      ]),
    }],
  ])],
  ["resolve-path", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-resolve-path-1.4.0-c4bda9f5efb2fce65247873ab36bb4d834fe16f7/node_modules/resolve-path/"),
      packageDependencies: new Map([
        ["http-errors", "1.6.3"],
        ["path-is-absolute", "1.0.1"],
        ["resolve-path", "1.4.0"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["koa-swig", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-koa-swig-2.2.1-0cc30c581faa7a8f0c1e5b5242fb3bd04a895969/node_modules/koa-swig/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["swig-templates", "2.0.3"],
        ["thenify", "3.3.0"],
        ["utils-merge", "1.0.1"],
        ["koa-swig", "2.2.1"],
      ]),
    }],
  ])],
  ["swig-templates", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-swig-templates-2.0.3-6b4c43b462175df2a8da857a2043379ec6ea6fd0/node_modules/swig-templates/"),
      packageDependencies: new Map([
        ["optimist", "0.6.1"],
        ["uglify-js", "2.6.0"],
        ["swig-templates", "2.0.3"],
      ]),
    }],
  ])],
  ["optimist", new Map([
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-optimist-0.6.1-da3ea74686fa21a19a111c326e90eb15a0196686/node_modules/optimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.10"],
        ["wordwrap", "0.0.3"],
        ["optimist", "0.6.1"],
      ]),
    }],
  ])],
  ["wordwrap", new Map([
    ["0.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-wordwrap-0.0.3-a3d5da6cd5c0bc0008d37234bbaf1bed63059107/node_modules/wordwrap/"),
      packageDependencies: new Map([
        ["wordwrap", "0.0.3"],
      ]),
    }],
    ["0.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-wordwrap-0.0.2-b79669bb42ecb409f83d583cad52ca17eaa1643f/node_modules/wordwrap/"),
      packageDependencies: new Map([
        ["wordwrap", "0.0.2"],
      ]),
    }],
  ])],
  ["uglify-js", new Map([
    ["2.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-uglify-js-2.6.0-25eaa1cc3550e39410ceefafd1cfbb6b6d15f001/node_modules/uglify-js/"),
      packageDependencies: new Map([
        ["async", "0.2.10"],
        ["source-map", "0.5.7"],
        ["uglify-to-browserify", "1.0.2"],
        ["yargs", "3.10.0"],
        ["uglify-js", "2.6.0"],
      ]),
    }],
    ["2.4.24", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-uglify-js-2.4.24-fad5755c1e1577658bb06ff9ab6e548c95bebd6e/node_modules/uglify-js/"),
      packageDependencies: new Map([
        ["async", "0.2.10"],
        ["source-map", "0.1.34"],
        ["uglify-to-browserify", "1.0.2"],
        ["yargs", "3.5.4"],
        ["uglify-js", "2.4.24"],
      ]),
    }],
  ])],
  ["async", new Map([
    ["0.2.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-async-0.2.10-b6bbe0b0674b9d719708ca38de8c237cb526c3d1/node_modules/async/"),
      packageDependencies: new Map([
        ["async", "0.2.10"],
      ]),
    }],
  ])],
  ["source-map", new Map([
    ["0.5.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.5.7"],
      ]),
    }],
    ["0.1.34", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-source-map-0.1.34-a7cfe89aec7b1682c3b198d0acfb47d7d090566b/node_modules/source-map/"),
      packageDependencies: new Map([
        ["amdefine", "1.0.1"],
        ["source-map", "0.1.34"],
      ]),
    }],
  ])],
  ["uglify-to-browserify", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-uglify-to-browserify-1.0.2-6e0924d6bda6b5afe349e39a6d632850a0f882b7/node_modules/uglify-to-browserify/"),
      packageDependencies: new Map([
        ["uglify-to-browserify", "1.0.2"],
      ]),
    }],
  ])],
  ["yargs", new Map([
    ["3.10.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-yargs-3.10.0-f7ee7bd857dd7c1d2d38c0e74efbd681d1431fd1/node_modules/yargs/"),
      packageDependencies: new Map([
        ["camelcase", "1.2.1"],
        ["cliui", "2.1.0"],
        ["decamelize", "1.2.0"],
        ["window-size", "0.1.0"],
        ["yargs", "3.10.0"],
      ]),
    }],
    ["3.5.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-yargs-3.5.4-d8aff8f665e94c34bd259bdebd1bfaf0ddd35361/node_modules/yargs/"),
      packageDependencies: new Map([
        ["camelcase", "1.2.1"],
        ["decamelize", "1.2.0"],
        ["window-size", "0.1.0"],
        ["wordwrap", "0.0.2"],
        ["yargs", "3.5.4"],
      ]),
    }],
  ])],
  ["camelcase", new Map([
    ["1.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-camelcase-1.2.1-9bb5304d2e0b56698b2c758b08a3eaa9daa58a39/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "1.2.1"],
      ]),
    }],
  ])],
  ["cliui", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-cliui-2.1.0-4b475760ff80264c762c3a1719032e91c7fea0d1/node_modules/cliui/"),
      packageDependencies: new Map([
        ["center-align", "0.1.3"],
        ["right-align", "0.1.3"],
        ["wordwrap", "0.0.2"],
        ["cliui", "2.1.0"],
      ]),
    }],
  ])],
  ["center-align", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-center-align-0.1.3-aa0d32629b6ee972200411cbd4461c907bc2b7ad/node_modules/center-align/"),
      packageDependencies: new Map([
        ["align-text", "0.1.4"],
        ["lazy-cache", "1.0.4"],
        ["center-align", "0.1.3"],
      ]),
    }],
  ])],
  ["align-text", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-align-text-0.1.4-0cd90a561093f35d0a99256c22b7069433fad117/node_modules/align-text/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["longest", "1.0.1"],
        ["repeat-string", "1.6.1"],
        ["align-text", "0.1.4"],
      ]),
    }],
  ])],
  ["kind-of", new Map([
    ["3.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "3.2.2"],
      ]),
    }],
  ])],
  ["longest", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-longest-1.0.1-30a0b2da38f73770e8294a0d22e6625ed77d0097/node_modules/longest/"),
      packageDependencies: new Map([
        ["longest", "1.0.1"],
      ]),
    }],
  ])],
  ["repeat-string", new Map([
    ["1.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/"),
      packageDependencies: new Map([
        ["repeat-string", "1.6.1"],
      ]),
    }],
  ])],
  ["lazy-cache", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-lazy-cache-1.0.4-a1d78fc3a50474cb80845d3b3b6e1da49a446e8e/node_modules/lazy-cache/"),
      packageDependencies: new Map([
        ["lazy-cache", "1.0.4"],
      ]),
    }],
  ])],
  ["right-align", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-right-align-0.1.3-61339b722fe6a3515689210d24e14c96148613ef/node_modules/right-align/"),
      packageDependencies: new Map([
        ["align-text", "0.1.4"],
        ["right-align", "0.1.3"],
      ]),
    }],
  ])],
  ["decamelize", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/"),
      packageDependencies: new Map([
        ["decamelize", "1.2.0"],
      ]),
    }],
  ])],
  ["window-size", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-window-size-0.1.0-5438cd2ea93b202efa3a19fe8887aee7c94f9c9d/node_modules/window-size/"),
      packageDependencies: new Map([
        ["window-size", "0.1.0"],
      ]),
    }],
  ])],
  ["utils-merge", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-utils-merge-1.0.1-9f95710f50a267947b2ccc124741c1028427e713/node_modules/utils-merge/"),
      packageDependencies: new Map([
        ["utils-merge", "1.0.1"],
      ]),
    }],
  ])],
  ["swig", new Map([
    ["1.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-swig-1.4.2-4085ca0453369104b5d483e2841b39b7ae1aaba5/node_modules/swig/"),
      packageDependencies: new Map([
        ["optimist", "0.6.1"],
        ["uglify-js", "2.4.24"],
        ["swig", "1.4.2"],
      ]),
    }],
  ])],
  ["amdefine", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-amdefine-1.0.1-4a5282ac164729e93619bcfd3ad151f817ce91f5/node_modules/amdefine/"),
      packageDependencies: new Map([
        ["amdefine", "1.0.1"],
      ]),
    }],
  ])],
  ["log4js", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-log4js-5.1.0-3fa5372055a4c2611ab92d80496bffc100841508/node_modules/log4js/"),
      packageDependencies: new Map([
        ["date-format", "2.1.0"],
        ["debug", "4.1.1"],
        ["flatted", "2.0.1"],
        ["rfdc", "1.1.4"],
        ["streamroller", "2.1.0"],
        ["log4js", "5.1.0"],
      ]),
    }],
  ])],
  ["date-format", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-date-format-2.1.0-31d5b5ea211cf5fd764cd38baf9d033df7e125cf/node_modules/date-format/"),
      packageDependencies: new Map([
        ["date-format", "2.1.0"],
      ]),
    }],
  ])],
  ["flatted", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-flatted-2.0.1-69e57caa8f0eacbc281d2e2cb458d46fdb449e08/node_modules/flatted/"),
      packageDependencies: new Map([
        ["flatted", "2.0.1"],
      ]),
    }],
  ])],
  ["rfdc", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-rfdc-1.1.4-ba72cc1367a0ccd9cf81a870b3b58bd3ad07f8c2/node_modules/rfdc/"),
      packageDependencies: new Map([
        ["rfdc", "1.1.4"],
      ]),
    }],
  ])],
  ["streamroller", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-streamroller-2.1.0-702de4dbba428c82ed3ffc87a75a21a61027e461/node_modules/streamroller/"),
      packageDependencies: new Map([
        ["date-format", "2.1.0"],
        ["debug", "4.1.1"],
        ["fs-extra", "8.1.0"],
        ["streamroller", "2.1.0"],
      ]),
    }],
  ])],
  ["fs-extra", new Map([
    ["8.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-fs-extra-8.1.0-49d43c45a88cd9677668cb7be1b46efdb8d2e1c0/node_modules/fs-extra/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["jsonfile", "4.0.0"],
        ["universalify", "0.1.2"],
        ["fs-extra", "8.1.0"],
      ]),
    }],
  ])],
  ["jsonfile", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-jsonfile-4.0.0-8771aae0799b64076b76640fca058f9c10e33ecb/node_modules/jsonfile/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["jsonfile", "4.0.0"],
      ]),
    }],
  ])],
  ["universalify", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v3/npm-universalify-0.1.2-b646f69be3942dabcecc9d6639c80dc105efaa66/node_modules/universalify/"),
      packageDependencies: new Map([
        ["universalify", "0.1.2"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["axios", "0.19.0"],
        ["co", "4.6.0"],
        ["cross-env", "5.2.0"],
        ["jsdoc", "3.6.3"],
        ["koa", "2.8.1"],
        ["koa-simple-router", "0.2.0"],
        ["koa-static", "5.0.0"],
        ["koa-swig", "2.2.1"],
        ["lodash", "4.17.15"],
        ["swig", "1.4.2"],
        ["log4js", "5.1.0"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["../../Library/Caches/Yarn/v3/npm-axios-0.19.0-8e09bff3d9122e133f7b8101c8fbdd00ed3d2ab8/node_modules/axios/", {"name":"axios","reference":"0.19.0"}],
  ["../../Library/Caches/Yarn/v3/npm-follow-redirects-1.5.10-7b7a9f9aea2fdff36786a94ff643ed07f4ff5e2a/node_modules/follow-redirects/", {"name":"follow-redirects","reference":"1.5.10"}],
  ["../../Library/Caches/Yarn/v3/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261/node_modules/debug/", {"name":"debug","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-debug-3.2.6-e83d17de16d8a7efb7717edbe5fb10135eee629b/node_modules/debug/", {"name":"debug","reference":"3.2.6"}],
  ["../../Library/Caches/Yarn/v3/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/", {"name":"debug","reference":"2.6.9"}],
  ["../../Library/Caches/Yarn/v3/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791/node_modules/debug/", {"name":"debug","reference":"4.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/", {"name":"ms","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009/node_modules/ms/", {"name":"ms","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-is-buffer-2.0.3-4ecf3fcf749cbd1e472689e109ac66261a25e725/node_modules/is-buffer/", {"name":"is-buffer","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/", {"name":"is-buffer","reference":"1.1.6"}],
  ["../../Library/Caches/Yarn/v3/npm-co-4.6.0-6ea6bdf3d853ae54ccb8e47bfa0bf3f9031fb184/node_modules/co/", {"name":"co","reference":"4.6.0"}],
  ["../../Library/Caches/Yarn/v3/npm-cross-env-5.2.0-6ecd4c015d5773e614039ee529076669b9d126f2/node_modules/cross-env/", {"name":"cross-env","reference":"5.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"6.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366/node_modules/nice-try/", {"name":"nice-try","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v3/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40/node_modules/path-key/", {"name":"path-key","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/", {"name":"semver","reference":"5.7.1"}],
  ["../../Library/Caches/Yarn/v3/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea/node_modules/shebang-command/", {"name":"shebang-command","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3/node_modules/shebang-regex/", {"name":"shebang-regex","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/", {"name":"which","reference":"1.3.1"}],
  ["../../Library/Caches/Yarn/v3/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/", {"name":"isexe","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/", {"name":"is-windows","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-jsdoc-3.6.3-dccea97d0e62d63d306b8b3ed1527173b5e2190d/node_modules/jsdoc/", {"name":"jsdoc","reference":"3.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-@babel-parser-7.5.5-02f077ac8817d3df4a832ef59de67565e71cca4b/node_modules/@babel/parser/", {"name":"@babel/parser","reference":"7.5.5"}],
  ["../../Library/Caches/Yarn/v3/npm-bluebird-3.5.5-a8d0afd73251effbbd5fe384a77d73003c17a71f/node_modules/bluebird/", {"name":"bluebird","reference":"3.5.5"}],
  ["../../Library/Caches/Yarn/v3/npm-catharsis-0.8.11-d0eb3d2b82b7da7a3ce2efb1a7b00becc6643468/node_modules/catharsis/", {"name":"catharsis","reference":"0.8.11"}],
  ["../../Library/Caches/Yarn/v3/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548/node_modules/lodash/", {"name":"lodash","reference":"4.17.15"}],
  ["../../Library/Caches/Yarn/v3/npm-escape-string-regexp-2.0.0-a30304e99daa32e23b2fd20f51babd07cffca344/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-js2xmlparser-4.0.0-ae14cc711b2892083eed6e219fbc993d858bc3a5/node_modules/js2xmlparser/", {"name":"js2xmlparser","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-xmlcreate-2.0.1-2ec38bd7b708d213fd1a90e2431c4af9c09f6a52/node_modules/xmlcreate/", {"name":"xmlcreate","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-klaw-3.0.0-b11bec9cf2492f06756d6e809ab73a2910259146/node_modules/klaw/", {"name":"klaw","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.2.2"}],
  ["../../Library/Caches/Yarn/v3/npm-markdown-it-8.4.2-386f98998dc15a37722aa7722084f4020bdd9b54/node_modules/markdown-it/", {"name":"markdown-it","reference":"8.4.2"}],
  ["../../Library/Caches/Yarn/v3/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/", {"name":"argparse","reference":"1.0.10"}],
  ["../../Library/Caches/Yarn/v3/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/", {"name":"sprintf-js","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-entities-1.1.2-bdfa735299664dfafd34529ed4f8522a275fea56/node_modules/entities/", {"name":"entities","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-linkify-it-2.2.0-e3b54697e78bf915c70a38acd78fd09e0058b1cf/node_modules/linkify-it/", {"name":"linkify-it","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-uc-micro-1.0.6-9c411a802a409a91fc6cf74081baba34b24499ac/node_modules/uc.micro/", {"name":"uc.micro","reference":"1.0.6"}],
  ["../../Library/Caches/Yarn/v3/npm-mdurl-1.0.1-fe85b2ec75a59037f2adfec100fd6c601761152e/node_modules/mdurl/", {"name":"mdurl","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-markdown-it-anchor-5.2.4-d39306fe4c199705b4479d3036842cf34dcba24f/node_modules/markdown-it-anchor/", {"name":"markdown-it-anchor","reference":"5.2.4"}],
  ["../../Library/Caches/Yarn/v3/npm-marked-0.7.0-b64201f051d271b1edc10a04d1ae9b74bb8e5c0e/node_modules/marked/", {"name":"marked","reference":"0.7.0"}],
  ["../../Library/Caches/Yarn/v3/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/", {"name":"mkdirp","reference":"0.5.1"}],
  ["../../Library/Caches/Yarn/v3/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/", {"name":"minimist","reference":"0.0.8"}],
  ["../../Library/Caches/Yarn/v3/npm-minimist-0.0.10-de3f98543dbf96082be48ad1a0c7cda836301dcf/node_modules/minimist/", {"name":"minimist","reference":"0.0.10"}],
  ["../../Library/Caches/Yarn/v3/npm-requizzle-0.2.3-4675c90aacafb2c036bd39ba2daa4a1cb777fded/node_modules/requizzle/", {"name":"requizzle","reference":"0.2.3"}],
  ["../../Library/Caches/Yarn/v3/npm-strip-json-comments-3.0.1-85713975a91fb87bf1b305cca77395e40d2a64a7/node_modules/strip-json-comments/", {"name":"strip-json-comments","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-taffydb-2.6.2-7cbcb64b5a141b6a2efc2c5d2c67b4e150b2a268/node_modules/taffydb/", {"name":"taffydb","reference":"2.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-underscore-1.9.1-06dce34a0e68a7babc29b365b8e74b8925203961/node_modules/underscore/", {"name":"underscore","reference":"1.9.1"}],
  ["../../Library/Caches/Yarn/v3/npm-koa-2.8.1-98e13b267ab8a1868f015a4b41b5a52e31457ce5/node_modules/koa/", {"name":"koa","reference":"2.8.1"}],
  ["../../Library/Caches/Yarn/v3/npm-accepts-1.3.7-531bc726517a3b2b41f850021c6cc15eaab507cd/node_modules/accepts/", {"name":"accepts","reference":"1.3.7"}],
  ["../../Library/Caches/Yarn/v3/npm-mime-types-2.1.24-b6f8d0b3e951efb77dedeca194cff6d16f676f81/node_modules/mime-types/", {"name":"mime-types","reference":"2.1.24"}],
  ["../../Library/Caches/Yarn/v3/npm-mime-db-1.40.0-a65057e998db090f732a68f6c276d387d4126c32/node_modules/mime-db/", {"name":"mime-db","reference":"1.40.0"}],
  ["../../Library/Caches/Yarn/v3/npm-negotiator-0.6.2-feacf7ccf525a77ae9634436a64883ffeca346fb/node_modules/negotiator/", {"name":"negotiator","reference":"0.6.2"}],
  ["../../Library/Caches/Yarn/v3/npm-cache-content-type-1.0.1-035cde2b08ee2129f4a8315ea8f00a00dba1453c/node_modules/cache-content-type/", {"name":"cache-content-type","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-ylru-1.2.1-f576b63341547989c1de7ba288760923b27fe84f/node_modules/ylru/", {"name":"ylru","reference":"1.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-content-disposition-0.5.3-e130caf7e7279087c5616c2007d0485698984fbd/node_modules/content-disposition/", {"name":"content-disposition","reference":"0.5.3"}],
  ["../../Library/Caches/Yarn/v3/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-content-type-1.0.4-e138cc75e040c727b1966fe5e5f8c9aee256fe3b/node_modules/content-type/", {"name":"content-type","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-cookies-0.7.3-7912ce21fbf2e8c2da70cf1c3f351aecf59dadfa/node_modules/cookies/", {"name":"cookies","reference":"0.7.3"}],
  ["../../Library/Caches/Yarn/v3/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9/node_modules/depd/", {"name":"depd","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-keygrip-1.0.3-399d709f0aed2bab0a059e0cdd3a5023a053e1dc/node_modules/keygrip/", {"name":"keygrip","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-delegates-1.0.0-84c6e159b81904fdca59a0ef44cd870d31250f9a/node_modules/delegates/", {"name":"delegates","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-destroy-1.0.4-978857442c44749e4206613e37946205826abd80/node_modules/destroy/", {"name":"destroy","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-error-inject-1.0.0-e2b3d91b54aed672f309d950d154850fa11d4f37/node_modules/error-inject/", {"name":"error-inject","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-escape-html-1.0.3-0258eae4d3d0c0974de1c169188ef0051d1d1988/node_modules/escape-html/", {"name":"escape-html","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-fresh-0.5.2-3d8cadd90d976569fa835ab1f8e4b23a105605a7/node_modules/fresh/", {"name":"fresh","reference":"0.5.2"}],
  ["../../Library/Caches/Yarn/v3/npm-http-assert-1.4.1-c5f725d677aa7e873ef736199b89686cceb37878/node_modules/http-assert/", {"name":"http-assert","reference":"1.4.1"}],
  ["../../Library/Caches/Yarn/v3/npm-deep-equal-1.0.1-f5d260292b660e084eff4cdbc9f08ad3247448b5/node_modules/deep-equal/", {"name":"deep-equal","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-http-errors-1.7.3-6c619e4f9c60308c38519498c14fbb10aacebb06/node_modules/http-errors/", {"name":"http-errors","reference":"1.7.3"}],
  ["../../Library/Caches/Yarn/v3/npm-http-errors-1.6.3-8b55680bb4be283a0b5bf4ea2e38580be1d9320d/node_modules/http-errors/", {"name":"http-errors","reference":"1.6.3"}],
  ["../../Library/Caches/Yarn/v3/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/", {"name":"inherits","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/", {"name":"inherits","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-setprototypeof-1.1.1-7e95acb24aa92f5885e0abef5ba131330d4ae683/node_modules/setprototypeof/", {"name":"setprototypeof","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-setprototypeof-1.1.0-d0bd85536887b6fe7c0d818cb962d9d91c54e656/node_modules/setprototypeof/", {"name":"setprototypeof","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c/node_modules/statuses/", {"name":"statuses","reference":"1.5.0"}],
  ["../../Library/Caches/Yarn/v3/npm-toidentifier-1.0.0-7e1be3470f1e77948bc43d94a3c8f4d7752ba553/node_modules/toidentifier/", {"name":"toidentifier","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-is-generator-function-1.0.7-d2132e529bb0000a7f80794d4bdf5cd5e5813522/node_modules/is-generator-function/", {"name":"is-generator-function","reference":"1.0.7"}],
  ["../../Library/Caches/Yarn/v3/npm-koa-compose-4.1.0-507306b9371901db41121c812e923d0d67d3e877/node_modules/koa-compose/", {"name":"koa-compose","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-koa-compose-3.2.1-a85ccb40b7d986d8e5a345b3a1ace8eabcf54de7/node_modules/koa-compose/", {"name":"koa-compose","reference":"3.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-koa-convert-1.2.0-da40875df49de0539098d1700b50820cebcd21d0/node_modules/koa-convert/", {"name":"koa-convert","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-any-promise-1.3.0-abc6afeedcea52e809cdc0376aed3ce39635d17f/node_modules/any-promise/", {"name":"any-promise","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-koa-is-json-1.0.0-273c07edcdcb8df6a2c1ab7d59ee76491451ec14/node_modules/koa-is-json/", {"name":"koa-is-json","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-on-finished-2.3.0-20f1336481b083cd75337992a16971aa2d906947/node_modules/on-finished/", {"name":"on-finished","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d/node_modules/ee-first/", {"name":"ee-first","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-only-0.0.2-2afde84d03e50b9a8edc444e30610a70295edfb4/node_modules/only/", {"name":"only","reference":"0.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-parseurl-1.3.3-9da19e7bee8d12dff0513ed5b76957793bc2e8d4/node_modules/parseurl/", {"name":"parseurl","reference":"1.3.3"}],
  ["../../Library/Caches/Yarn/v3/npm-type-is-1.6.18-4e552cd05df09467dcbc4ef739de89f2cf37c131/node_modules/type-is/", {"name":"type-is","reference":"1.6.18"}],
  ["../../Library/Caches/Yarn/v3/npm-media-typer-0.3.0-8710d7af0aa626f8fffa1ce00168545263255748/node_modules/media-typer/", {"name":"media-typer","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-vary-1.1.2-2299f02c6ded30d4a5961b0b9f74524a18f634fc/node_modules/vary/", {"name":"vary","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-koa-simple-router-0.2.0-29ba92f187107d6838c77ac24b7a473a151c7a94/node_modules/koa-simple-router/", {"name":"koa-simple-router","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-methods-1.1.2-5529a4d67654134edcc5266656835b0f851afcee/node_modules/methods/", {"name":"methods","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v3/npm-path-to-regexp-1.7.0-59fde0f435badacba103a84e9d3bc64e96b9937d/node_modules/path-to-regexp/", {"name":"path-to-regexp","reference":"1.7.0"}],
  ["../../Library/Caches/Yarn/v3/npm-isarray-0.0.1-8a18acfca9a8f4177e09abfc6038939b05d1eedf/node_modules/isarray/", {"name":"isarray","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-koa-static-5.0.0-5e92fc96b537ad5219f425319c95b64772776943/node_modules/koa-static/", {"name":"koa-static","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-koa-send-5.0.0-5e8441e07ef55737734d7ced25b842e50646e7eb/node_modules/koa-send/", {"name":"koa-send","reference":"5.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-mz-2.7.0-95008057a56cafadc2bc63dde7f9ff6955948e32/node_modules/mz/", {"name":"mz","reference":"2.7.0"}],
  ["../../Library/Caches/Yarn/v3/npm-object-assign-4.1.1-2109adc7965887cfc05cbbd442cac8bfbb360863/node_modules/object-assign/", {"name":"object-assign","reference":"4.1.1"}],
  ["../../Library/Caches/Yarn/v3/npm-thenify-all-1.6.0-1a1918d402d8fc3f98fbf234db0bcc8cc10e9726/node_modules/thenify-all/", {"name":"thenify-all","reference":"1.6.0"}],
  ["../../Library/Caches/Yarn/v3/npm-thenify-3.3.0-e69e38a1babe969b0108207978b9f62b88604839/node_modules/thenify/", {"name":"thenify","reference":"3.3.0"}],
  ["../../Library/Caches/Yarn/v3/npm-resolve-path-1.4.0-c4bda9f5efb2fce65247873ab36bb4d834fe16f7/node_modules/resolve-path/", {"name":"resolve-path","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v3/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-koa-swig-2.2.1-0cc30c581faa7a8f0c1e5b5242fb3bd04a895969/node_modules/koa-swig/", {"name":"koa-swig","reference":"2.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-swig-templates-2.0.3-6b4c43b462175df2a8da857a2043379ec6ea6fd0/node_modules/swig-templates/", {"name":"swig-templates","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-optimist-0.6.1-da3ea74686fa21a19a111c326e90eb15a0196686/node_modules/optimist/", {"name":"optimist","reference":"0.6.1"}],
  ["../../Library/Caches/Yarn/v3/npm-wordwrap-0.0.3-a3d5da6cd5c0bc0008d37234bbaf1bed63059107/node_modules/wordwrap/", {"name":"wordwrap","reference":"0.0.3"}],
  ["../../Library/Caches/Yarn/v3/npm-wordwrap-0.0.2-b79669bb42ecb409f83d583cad52ca17eaa1643f/node_modules/wordwrap/", {"name":"wordwrap","reference":"0.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-uglify-js-2.6.0-25eaa1cc3550e39410ceefafd1cfbb6b6d15f001/node_modules/uglify-js/", {"name":"uglify-js","reference":"2.6.0"}],
  ["../../Library/Caches/Yarn/v3/npm-uglify-js-2.4.24-fad5755c1e1577658bb06ff9ab6e548c95bebd6e/node_modules/uglify-js/", {"name":"uglify-js","reference":"2.4.24"}],
  ["../../Library/Caches/Yarn/v3/npm-async-0.2.10-b6bbe0b0674b9d719708ca38de8c237cb526c3d1/node_modules/async/", {"name":"async","reference":"0.2.10"}],
  ["../../Library/Caches/Yarn/v3/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/", {"name":"source-map","reference":"0.5.7"}],
  ["../../Library/Caches/Yarn/v3/npm-source-map-0.1.34-a7cfe89aec7b1682c3b198d0acfb47d7d090566b/node_modules/source-map/", {"name":"source-map","reference":"0.1.34"}],
  ["../../Library/Caches/Yarn/v3/npm-uglify-to-browserify-1.0.2-6e0924d6bda6b5afe349e39a6d632850a0f882b7/node_modules/uglify-to-browserify/", {"name":"uglify-to-browserify","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v3/npm-yargs-3.10.0-f7ee7bd857dd7c1d2d38c0e74efbd681d1431fd1/node_modules/yargs/", {"name":"yargs","reference":"3.10.0"}],
  ["../../Library/Caches/Yarn/v3/npm-yargs-3.5.4-d8aff8f665e94c34bd259bdebd1bfaf0ddd35361/node_modules/yargs/", {"name":"yargs","reference":"3.5.4"}],
  ["../../Library/Caches/Yarn/v3/npm-camelcase-1.2.1-9bb5304d2e0b56698b2c758b08a3eaa9daa58a39/node_modules/camelcase/", {"name":"camelcase","reference":"1.2.1"}],
  ["../../Library/Caches/Yarn/v3/npm-cliui-2.1.0-4b475760ff80264c762c3a1719032e91c7fea0d1/node_modules/cliui/", {"name":"cliui","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-center-align-0.1.3-aa0d32629b6ee972200411cbd4461c907bc2b7ad/node_modules/center-align/", {"name":"center-align","reference":"0.1.3"}],
  ["../../Library/Caches/Yarn/v3/npm-align-text-0.1.4-0cd90a561093f35d0a99256c22b7069433fad117/node_modules/align-text/", {"name":"align-text","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/", {"name":"kind-of","reference":"3.2.2"}],
  ["../../Library/Caches/Yarn/v3/npm-longest-1.0.1-30a0b2da38f73770e8294a0d22e6625ed77d0097/node_modules/longest/", {"name":"longest","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/", {"name":"repeat-string","reference":"1.6.1"}],
  ["../../Library/Caches/Yarn/v3/npm-lazy-cache-1.0.4-a1d78fc3a50474cb80845d3b3b6e1da49a446e8e/node_modules/lazy-cache/", {"name":"lazy-cache","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v3/npm-right-align-0.1.3-61339b722fe6a3515689210d24e14c96148613ef/node_modules/right-align/", {"name":"right-align","reference":"0.1.3"}],
  ["../../Library/Caches/Yarn/v3/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/", {"name":"decamelize","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v3/npm-window-size-0.1.0-5438cd2ea93b202efa3a19fe8887aee7c94f9c9d/node_modules/window-size/", {"name":"window-size","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-utils-merge-1.0.1-9f95710f50a267947b2ccc124741c1028427e713/node_modules/utils-merge/", {"name":"utils-merge","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-swig-1.4.2-4085ca0453369104b5d483e2841b39b7ae1aaba5/node_modules/swig/", {"name":"swig","reference":"1.4.2"}],
  ["../../Library/Caches/Yarn/v3/npm-amdefine-1.0.1-4a5282ac164729e93619bcfd3ad151f817ce91f5/node_modules/amdefine/", {"name":"amdefine","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-log4js-5.1.0-3fa5372055a4c2611ab92d80496bffc100841508/node_modules/log4js/", {"name":"log4js","reference":"5.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-date-format-2.1.0-31d5b5ea211cf5fd764cd38baf9d033df7e125cf/node_modules/date-format/", {"name":"date-format","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-flatted-2.0.1-69e57caa8f0eacbc281d2e2cb458d46fdb449e08/node_modules/flatted/", {"name":"flatted","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v3/npm-rfdc-1.1.4-ba72cc1367a0ccd9cf81a870b3b58bd3ad07f8c2/node_modules/rfdc/", {"name":"rfdc","reference":"1.1.4"}],
  ["../../Library/Caches/Yarn/v3/npm-streamroller-2.1.0-702de4dbba428c82ed3ffc87a75a21a61027e461/node_modules/streamroller/", {"name":"streamroller","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-fs-extra-8.1.0-49d43c45a88cd9677668cb7be1b46efdb8d2e1c0/node_modules/fs-extra/", {"name":"fs-extra","reference":"8.1.0"}],
  ["../../Library/Caches/Yarn/v3/npm-jsonfile-4.0.0-8771aae0799b64076b76640fca058f9c10e33ecb/node_modules/jsonfile/", {"name":"jsonfile","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v3/npm-universalify-0.1.2-b646f69be3942dabcecc9d6639c80dc105efaa66/node_modules/universalify/", {"name":"universalify","reference":"0.1.2"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 137 && relativeLocation[136] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 137)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 133 && relativeLocation[132] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 133)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 129 && relativeLocation[128] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 129)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 128 && relativeLocation[127] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 128)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 127 && relativeLocation[126] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 127)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 125 && relativeLocation[124] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 125)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 123 && relativeLocation[122] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 123)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 121 && relativeLocation[120] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 121)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 119 && relativeLocation[118] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 119)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 117 && relativeLocation[116] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 117)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 116 && relativeLocation[115] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 116)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 115 && relativeLocation[114] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 115)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 114 && relativeLocation[113] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 114)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 113 && relativeLocation[112] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 113)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 112 && relativeLocation[111] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 112)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 111 && relativeLocation[110] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 111)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 110 && relativeLocation[109] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 110)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 109 && relativeLocation[108] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 109)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 107 && relativeLocation[106] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 107)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 105 && relativeLocation[104] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 105)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 103 && relativeLocation[102] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 103)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 101 && relativeLocation[100] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 101)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 99 && relativeLocation[98] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 99)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`,
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        unqualifiedPath = nextUnqualifiedPath;
        continue;
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

// eslint-disable-next-line no-unused-vars
function normalizePath(fsPath) {
  return process.platform === 'win32' ? fsPath.replace(backwardSlashRegExp, '/') : fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(issuer)) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        },
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          },
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName},
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName},
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName},
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `,
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates},
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)},
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {},
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath},
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          },
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    if (patchedModules.has(request)) {
      module.exports = patchedModules.get(request)(module.exports);
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`,
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // see https://github.com/browserify/resolve/blob/master/lib/caller.js
  const getCaller = () => {
    const origPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack;
    Error.prepareStackTrace = origPrepareStackTrace;

    return stack[2].getFileName();
  };

  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // We need to shim the "resolve" module, because Liftoff uses it in order to find the location
  // of the module in the dependency tree. And Liftoff is used to power Gulp, which doesn't work
  // at all unless modulePath is set, which we cannot configure from any other way than through
  // the Liftoff pipeline (the key isn't whitelisted for env or cli options).

  patchedModules.set(/^resolve$/, realResolve => {
    const mustBeShimmed = caller => {
      const callerLocator = exports.findPackageLocator(caller);

      return callerLocator && callerLocator.name === 'liftoff';
    };

    const attachCallerToOptions = (caller, options) => {
      if (!options.basedir) {
        options.basedir = path.dirname(caller);
      }
    };

    const resolveSyncShim = (request, {basedir}) => {
      return exports.resolveRequest(request, basedir, {
        considerBuiltins: false,
      });
    };

    const resolveShim = (request, options, callback) => {
      setImmediate(() => {
        let error;
        let result;

        try {
          result = resolveSyncShim(request, options);
        } catch (thrown) {
          error = thrown;
        }

        callback(error, result);
      });
    };

    return Object.assign(
      (request, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        } else if (!options) {
          options = {};
        }

        const caller = getCaller();
        attachCallerToOptions(caller, options);

        if (mustBeShimmed(caller)) {
          return resolveShim(request, options, callback);
        } else {
          return realResolve.sync(request, options, callback);
        }
      },
      {
        sync: (request, options) => {
          if (!options) {
            options = {};
          }

          const caller = getCaller();
          attachCallerToOptions(caller, options);

          if (mustBeShimmed(caller)) {
            return resolveSyncShim(request, options);
          } else {
            return realResolve.sync(request, options);
          }
        },
        isCore: request => {
          return realResolve.isCore(request);
        },
      },
    );
  });
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
