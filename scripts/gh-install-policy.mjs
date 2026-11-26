/** Build-time preparation; runtime execution remains an independent opt-in. */
export function preparePinnedGhAtBuild(env=process.env) {
  return env.NYX_DEPLOYMENT_MODE === 'public' &&
    env.NYX_PUBLIC_CONNECTORS_ENABLED === 'true';
}
