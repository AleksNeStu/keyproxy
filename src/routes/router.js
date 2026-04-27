'use strict';

class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * Register a route.
   * @param {Object} opts
   * @param {string}   opts.method  - HTTP method ('GET', 'POST', etc.)
   * @param {string}   opts.path    - Path pattern
   * @param {boolean}  [opts.prefix] - If true, match with startsWith (default false)
   * @param {Function} opts.handler - (ctx) => void
   */
  register({ method, path, prefix = false, handler }) {
    this.routes.push({ method, path, prefix, handler });
  }

  /**
   * Dispatch a request through the route table.
   * Returns true if a route matched, false otherwise.
   * @param {Object} ctx - { server, req, res, body, path, params }
   * @returns {Promise<boolean>}
   */
  async dispatch(ctx) {
    for (const route of this.routes) {
      if (route.method !== ctx.req.method) continue;

      if (route.prefix) {
        if (!ctx.path.startsWith(route.path)) continue;
      } else {
        if (ctx.path !== route.path) continue;
      }

      await route.handler(ctx);
      return true;
    }
    return false;
  }
}

module.exports = Router;
