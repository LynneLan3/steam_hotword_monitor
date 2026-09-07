/** One-time manual RAW export. Does not touch History Spreadsheet. */
function exportMonitoringRawNow() {
  var runId = 'manual-' + Utilities.formatDate(new Date(), 'Asia/Shanghai', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid();
  return saveSteamMonitoringRaw_(runId, new Date());
}
