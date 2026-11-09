/** Chemins des endpoints de l'API, relatifs à `environment.apiUrl`. */
export const API_ENDPOINTS = {
  auth: {
    login: '/v1/admin/auth/login',
    verify2fa: '/v1/admin/auth/2fa',
    password: '/v1/admin/auth/password',
    logout: '/v1/admin/auth/logout',
    me: '/v1/admin/auth/me'
  },
  users: {
    list: '/v1/admin/users',
    roles: '/v1/admin/roles',
    permission: (key: string) => `/v1/admin/roles/permissions/${key}`,
    invite: '/v1/admin/users',
    update: (id: string) => `/v1/admin/users/${id}`,
    resendInvitation: (id: string) => `/v1/admin/users/${id}/invitation`,
    reset2fa: (id: string) => `/v1/admin/users/${id}/reset-2fa`
  },
  tariffs: {
    overview: '/v1/admin/tariffs',
    history: '/v1/admin/tariffs/history',
    commissionRules: '/v1/admin/commission-rules',
    commissionRule: (id: string) => `/v1/admin/commission-rules/${id}`,
    endCommissionRule: (id: string) => `/v1/admin/commission-rules/${id}/end`,
    pricingRules: '/v1/admin/pricing-rules',
    endPricingRule: (id: string) => `/v1/admin/pricing-rules/${id}/end`,
    categories: '/v1/admin/categories',
    category: (code: string) => `/v1/admin/categories/${code}`
  },
  dashboard: {
    summary: '/v1/admin/dashboard',
    balances: '/v1/admin/finance/balances',
    liveMap: '/v1/admin/live-map'
  },
  rides: {
    list: '/v1/admin/rides',
    detail: (id: string) => `/v1/admin/rides/${id}`,
    cancel: (id: string) => `/v1/admin/rides/${id}/cancel`,
    forceComplete: (id: string) => `/v1/admin/rides/${id}/force-complete`,
    refund: (id: string) => `/v1/admin/rides/${id}/refunds`,
    ticket: (id: string) => `/v1/admin/rides/${id}/tickets`
  },
  campaigns: {
    options: '/v1/admin/campaigns/options',
    list: '/v1/admin/campaigns',
    create: '/v1/admin/campaigns',
    preview: '/v1/admin/campaigns/preview',
    cancel: (id: string) => `/v1/admin/campaigns/${id}/cancel`
  },
  sos: {
    list: '/v1/admin/sos',
    acknowledge: (id: string) => `/v1/admin/sos/${id}/acknowledge`,
    resolve: (id: string) => `/v1/admin/sos/${id}/resolve`
  },
  tickets: {
    list: '/v1/admin/tickets',
    detail: (id: string) => `/v1/admin/tickets/${id}`,
    messages: (id: string) => `/v1/admin/tickets/${id}/messages`,
    warnDriver: (id: string) => `/v1/admin/tickets/${id}/warn-driver`
  },
  clients: {
    list: '/v1/admin/clients',
    detail: (id: string) => `/v1/admin/clients/${id}`,
    block: (id: string) => `/v1/admin/clients/${id}/block`,
    unblock: (id: string) => `/v1/admin/clients/${id}/unblock`,
    revealPhone: (id: string) => `/v1/admin/clients/${id}/reveal-phone`
  },
  drivers: {
    list: '/v1/admin/drivers',
    detail: (id: string) => `/v1/admin/drivers/${id}`,
    /** validate, request-fix, refuse, suspend, reactivate, ban. */
    action: (id: string, action: string) => `/v1/admin/drivers/${id}/${action}`,
    dossier: (id: string) => `/v1/admin/drivers/${id}/dossier`,
    documentFile: (id: string, docId: string) => `/v1/admin/drivers/${id}/documents/${docId}/file`,
    approveDocument: (id: string, docId: string) => `/v1/admin/drivers/${id}/documents/${docId}/approve`,
    rejectDocument: (id: string, docId: string) => `/v1/admin/drivers/${id}/documents/${docId}/reject`,
    appointment: (id: string) => `/v1/admin/drivers/${id}/appointment`,
    payoutMsisdnRequest: (id: string) => `/v1/admin/drivers/${id}/payout-msisdn-requests`,
    revealPhone: (id: string) => `/v1/admin/drivers/${id}/reveal-phone`,
    documentTypes: '/v1/admin/document-types',
    documentType: (code: string) => `/v1/admin/document-types/${code}`,
    selfies: '/v1/admin/daily-selfies',
    selfieFile: (id: string) => `/v1/admin/daily-selfies/${id}/file`,
    selfieReference: (id: string) => `/v1/admin/daily-selfies/${id}/reference`,
    approveSelfie: (id: string) => `/v1/admin/daily-selfies/${id}/approve`,
    rejectSelfie: (id: string) => `/v1/admin/daily-selfies/${id}/reject`
  },
  wallets: {
    list: '/v1/admin/wallets',
    detail: (driverId: string) => `/v1/admin/wallets/${driverId}`,
    adjust: (driverId: string) => `/v1/admin/wallets/${driverId}/adjustments`,
    cashBlock: (driverId: string) => `/v1/admin/wallets/${driverId}/cash-block`
  },
  zones: {
    /** Public : contours simplifiés des zones actives. */
    active: '/v1/zones/active',
    list: '/v1/admin/zones',
    create: '/v1/admin/zones',
    simulate: '/v1/admin/zones/simulate',
    detail: (id: string) => `/v1/admin/zones/${id}`,
    history: (id: string) => `/v1/admin/zones/${id}/history`,
    geometry: (id: string) => `/v1/admin/zones/${id}/geometry`,
    settings: (id: string) => `/v1/admin/zones/${id}/settings`,
    neighbors: (id: string) => `/v1/admin/zones/${id}/neighbors`,
    status: (id: string) => `/v1/admin/zones/${id}/status`
  },
  reports: {
    summary: '/v1/admin/reports/summary',
    ridesCsv: '/v1/admin/reports/rides.csv'
  },
  settings: {
    list: '/v1/admin/settings',
    update: (key: string) => `/v1/admin/settings/${key}`,
    /** Clés Google Maps des apps (Android, iOS, web). */
    appParams: '/v1/admin/app-params'
  },
  payments: {
    /** Transactions Orange Money (paginé, ?q&type=CHARGE|REFUND|PAYOUT&status=PENDING|SUCCESS|FAILED|EXPIRED). */
    transactions: '/v1/admin/finance/transactions',
    recheck: (id: string) => `/v1/admin/finance/transactions/${id}/recheck`,
    /** Relance d'un dépôt en échec (remboursement ou versement) ; bulkRetry : plusieurs à la fois ({ids, reason}). */
    retry: (id: string) => `/v1/admin/finance/transactions/${id}/retry`,
    bulkRetry: '/v1/admin/finance/transactions/retry',
    hold: (id: string) => `/v1/admin/finance/transactions/${id}/hold`,
    release: (id: string) => `/v1/admin/finance/transactions/${id}/release`,
    /** Changements de numéro de versement à valider (paginé, ?q&status=PENDING|APPROVED|REJECTED). */
    payoutMsisdnRequests: '/v1/admin/finance/payout-msisdn-requests',
    approvePayoutMsisdn: (id: string) => `/v1/admin/finance/payout-msisdn-requests/${id}/approve`,
    rejectPayoutMsisdn: (id: string) => `/v1/admin/finance/payout-msisdn-requests/${id}/reject`,
    /** Demandes de remboursement au-delà du seuil (paginé, ?q&status=PENDING|APPROVED|REJECTED). */
    refundRequests: '/v1/admin/finance/refund-requests',
    approveRefund: (id: string) => `/v1/admin/finance/refund-requests/${id}/approve`,
    rejectRefund: (id: string) => `/v1/admin/finance/refund-requests/${id}/reject`
  },
  reconciliation: {
    /** GET : relevés importés (paginé) ; POST multipart `file` : import CSV et rapprochement automatique. */
    statements: '/v1/admin/finance/statements',
    statement: (id: string) => `/v1/admin/finance/statements/${id}`,
    explainLine: (id: string) => `/v1/admin/finance/statement-lines/${id}/explain`,
    refundLine: (id: string) => `/v1/admin/finance/statement-lines/${id}/refund`
  },
  app: {
    /** Public (sans connexion) : clés Google Maps des apps, dont celle du web utilisée par ce backoffice. */
    params: '/v1/app/params'
  },
  auditLogs: {
    list: '/v1/admin/audit-logs',
    export: '/v1/admin/audit-logs/export.csv',
    actions: '/v1/admin/audit-logs/actions'
  }
} as const;
