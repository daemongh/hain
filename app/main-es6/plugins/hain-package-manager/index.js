'use strict';

const co = require('co');
const Packman = require('./packman');
const got = require('got');

const pm = new Packman('./plugins', './_temp');

const COMMANDS_RE = / (install|remove|list)(\s+([^\s]+))?/i;
const NAME = 'hain-package-manager (experimental)';
const PREFIX = '/hpm';

const COMMANDS = [`${PREFIX} install `, `${PREFIX} remove `, `${PREFIX} list `];
const CACHE_DURATION_SEC = 5 * 60; // 5 mins

function* searchPackages(query) {
  const query_enc = query;
  const url = `http://npmsearch.com/query?q=name:${query_enc}&fields=name,rating,version,description&default_operator=AND&sort=rating:desc`;
  const res = yield got(url, { json: true });
  return res.body.results.map(x => {
    return {
      name: x.name[0],
      version: x.version[0],
      desc: x.description[0]
    };
  });
}

module.exports = (context) => {
  const toast = context.toast;
  const logger = context.logger;
  const matcher = context.matcher;

  let currentStatus = null;
  let progressTimer = 0;
  let lastUpdatedTime = 0;
  let availablePackages = [];

  function* startup() {
    yield pm.readPackages();
    checkAvailablePackages();
  }

  function checkAvailablePackages() {
    const elapsed = (Date.now() - lastUpdatedTime) / 1000;
    if (elapsed <= CACHE_DURATION_SEC)
      return;
    lastUpdatedTime = Date.now();
    return co(function* () {
      currentStatus = 'fetching available packages...';
      availablePackages = yield searchPackages('hain-plugin');
      currentStatus = null;
    });
  }

  function* search(query, reply) {
    if (currentStatus === null) {
      checkAvailablePackages();
    }
    clearTimeout(progressTimer);
    if (currentStatus) {
      reply([{
        id: '**',
        title: currentStatus,
        desc: NAME,
        icon: '#fa fa-spinner fa-spin'
      }]);
      progressTimer = setInterval(() => {
        if (!currentStatus) {
          reply({ remove: '**' });
          _parseCommandsWrap(query, reply);
          return clearTimeout(progressTimer);
        }
      }, 500);
      return;
    }
    const ret = yield* parseCommands(query, reply);
    return ret;
  }

  function _parseCommandsWrap(query, reply) {
    co(parseCommands(query)).then((x) => {
      reply(x);
    });
  }

  function* parseCommands(query) {
    // install
    const parsed = COMMANDS_RE.exec(query.toLowerCase());
    if (!parsed) {
      return _makeCommandsHelp(query);
    }
    const command = parsed[1];
    const arg = parsed[2];
    if (command === 'install') {
      if (arg) {
        return matcher.fuzzy(availablePackages, arg.trim(), x => x.name).map(x => {
          const m = matcher.makeStringBoldHtml(x.elem.name, x.matches);
          return {
            id: x.elem.name,
            payload: 'install',
            title: `install ${m}</b> ${x.elem.version}`,
            desc: x.elem.desc || NAME
          };
        });
      }
      return availablePackages.map(x => {
        return {
          id: x.name,
          payload: 'install',
          title: `install <b>${x.name}</b> ${x.version}`,
          desc: x.desc || NAME
        };
      });
    }
    if (command === 'remove') {
      const packages = pm.listPackages();
      return packages.map((x) => {
        return {
          id: x.name,
          payload: 'remove',
          title: `remove <b>${x.name}</b> ${x.version}`,
          desc: NAME
        };
      });
    }
    // list
    if (command === 'list') {
      const packages = pm.listPackages();
      return packages.map((x) => {
        return { id: x.name, title: `<b>${x.name}</b> ${x.version}`, desc: NAME };
      });
    }
    return _makeCommandsHelp(query);
  }

  function _makeCommandsHelp(query) {
    const ret = matcher.head(COMMANDS, `${PREFIX}${query}`, (x) => x).map((x) => {
      return {
        redirect: x.elem,
        title: matcher.makeStringBoldHtml(x.elem, x.matches),
        desc: NAME
      };
    });
    return ret;
  }

  function* execute(id, payload) {
    if (payload === 'install') {
      co(installPackage(id, 'latest'));
      return `${PREFIX} `;
    } else if (payload === 'remove') {
      co(removePackage(id));
      return `${PREFIX} `;
    }
  }

  function* removePackage(packageName) {
    currentStatus = `removing <b>${packageName}`;
    try {
      yield pm.removePackage(packageName);
      toast(`${packageName} removed, <b>Restart</b> Hain to take effect`, 3000);
    } catch (e) {
      toast(e.toString());
    } finally {
      currentStatus = null;
    }
  }

  function* installPackage(packageName, versionRange) {
    logger.log(`installing ${packageName}`);
    currentStatus = `installing <b>${packageName}</b>`;
    try {
      yield pm.installPackage(packageName, versionRange);
      toast(`${packageName} installed, <b>Restart</b> Hain to take effect`, 3000);
      logger.log(`${packageName} installed`);
    } catch (e) {
      toast(e.toString());
      logger.log(`${packageName} ${e}`);
      throw e;
    } finally {
      currentStatus = null;
    }
  }

  return {
    startup: co.wrap(startup),
    search: co.wrap(search),
    execute: co.wrap(execute)
  };
};