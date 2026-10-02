export const APP_RULES = {
  companyName: 'Quadro Holdings LTEE',
  requiredServices: ['doordash', 'uber_eats', 'skip_the_dishes'] as const,
  statusRules: {
    Z: { activation_status: 'active', open_status: 'closed' },
    I: { activation_status: 'deactivated', open_status: 'unknown' },
    grey_circle: { activation_status: 'deactivated', open_status: 'unknown' }
  },
  safety: {
    quickbooksIsOptionalExportOnly: true,
    aiCannotApproveOrPost: true,
    liveConnectorsRequireOwnerApproval: true
  }
};

export const featureFlags = {
  liveConnectorsEnabled: process.env.LIVE_CONNECTORS_GLOBAL_ENABLED === 'true',
  aiSupervisorEnabled: process.env.AI_SUPERVISOR_ENABLED !== 'false',
  quickBooksExportEnabled: process.env.QUICKBOOKS_EXPORT_ENABLED === 'true'
};
