const { getCDNBaseUrl, setCDNBaseUrl, getCDNStatus, clearCache, updateAllResources } = require('./cdnProxy');
const { getAllSystemConfig, setMultipleSystemConfig, deleteSystemConfig, initDefaultConfig, getSmtpConfig, setSmtpConfig } = require('./systemConfig');
const { cleanupExpiredSessions } = require('./chunkUpload');

function getCdnConfig() {
  return { baseUrl: getCDNBaseUrl() };
}

function updateCdnConfig(baseUrl) {
  setCDNBaseUrl(baseUrl);
  return { baseUrl };
}

async function getSystemConfigSnapshot() {
  return getAllSystemConfig();
}

async function updateSystemConfigs(configs) {
  await setMultipleSystemConfig(configs);
}

async function resetSystemConfigs(keys) {
  for (const key of keys) {
    await deleteSystemConfig(key);
  }
}

async function initializeDefaultSystemConfig() {
  await initDefaultConfig();
}

async function getSmtpConfigSnapshot() {
  return getSmtpConfig();
}

async function updateSmtpSettings(settings) {
  await setSmtpConfig(settings);
}

async function cleanupUploadSessions() {
  return cleanupExpiredSessions();
}

module.exports = {
  updateAllResources,
  getCDNStatus,
  clearCache,
  getCdnConfig,
  updateCdnConfig,
  getSystemConfigSnapshot,
  updateSystemConfigs,
  resetSystemConfigs,
  initializeDefaultSystemConfig,
  getSmtpConfigSnapshot,
  updateSmtpSettings,
  cleanupUploadSessions
};
