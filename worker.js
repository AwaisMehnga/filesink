import { handleSignalingRequest } from './signaling/handler.js';

export default {
  async fetch(request, env) {
    return handleSignalingRequest(request, env);
  }
};
