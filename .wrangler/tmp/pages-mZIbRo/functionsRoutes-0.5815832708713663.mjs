import { onRequest as __api___route___js_onRequest } from "/home/mehnga/workspace/pnge/Speech to text/functions/api/[[route]].js"

export const routes = [
    {
      routePath: "/api/:route*",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api___route___js_onRequest],
    },
  ]