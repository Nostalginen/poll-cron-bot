const SKIPPED_DATES = [
    '2026-06-19',
    '2026-06-20',
];

function isTodaySkipped() {
    // Haetaan tämän päivän päivämäärä muodossa YYYY-MM-DD Helsingin ajassa
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    return SKIPPED_DATES.includes(todayStr);
}

module.exports = {
    SKIPPED_DATES,
    isTodaySkipped
};