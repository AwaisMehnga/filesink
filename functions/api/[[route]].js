import { handleSignalingRequest } from '../../signaling/handler.js';

export const onRequest = async (context) => handleSignalingRequest(context.request, context.env);
