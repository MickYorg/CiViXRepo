// Flattened copy of builder.html's CATALOG issue names (its ALL_ISSUE_NAMES),
// for server-side AI prompts that need to classify onto the same fixed
// taxonomy digest.js's SYNONYMS map keys off of. builder.html is the
// canonical source — if CATALOG there changes, update this list to match
// or server-built content (headlines-batch.js) will quietly drift from
// what the client itself would classify onto.
export const ALL_ISSUE_NAMES = [
  'Wages and labor', 'Taxes', 'Cost of living', 'Small business', 'Trade and tariffs',
  'Healthcare access', 'Drug pricing', 'Public health', 'Reproductive health', 'Mental health',
  'Housing affordability', 'Zoning and development', 'Homelessness', 'Tenant rights',
  'Public schools', 'Higher education cost', 'Curriculum and books', 'Childcare',
  'Climate policy', 'Energy costs', 'Water and air quality', 'Public lands',
  'Policing', 'Criminal justice reform', 'Gun policy', 'Courts',
  'Voting access', 'Redistricting', 'Campaign finance', 'Government transparency',
  'Data privacy', 'AI regulation', 'Platform accountability', 'Broadband access',
  'Transit', 'Roads and bridges', 'Immigration', 'Rural access'
];
