import { CHANGELOG_ENTRIES } from '/js/changelog-data.js?v=20260615-release-111';

const timeline = document.getElementById('timeline');
const totalVersions = document.getElementById('total-versions');
const totalFeatures = document.getElementById('total-features');
const latestDate = document.getElementById('latest-date');
const releaseSummary = document.getElementById('release-summary');
const monthFilter = document.getElementById('changelog-month-filter');
const changelogCount = document.getElementById('changelog-count');

if (totalVersions) totalVersions.textContent = CHANGELOG_ENTRIES.length;
if (totalFeatures) totalFeatures.textContent = CHANGELOG_ENTRIES.reduce((sum, entry) => sum + (entry.details?.length || 0), 0);
if (latestDate && CHANGELOG_ENTRIES.length > 0) latestDate.textContent = CHANGELOG_ENTRIES[0].date;

function renderTimeline(entries) {
  if (!timeline) return;
  timeline.innerHTML = entries.map((entry) => `
    <article class="entry">
      <div class="entry-date">${entry.date}${entry.version ? `<span>${entry.version}</span>` : ''}</div>
      <h2>${entry.title}${entry.type ? `<span class="entry-badge">${entry.type}</span>` : ''}</h2>
      <p>${entry.summary}</p>
      <div class="entry-list">
        ${(entry.details || []).map((detail) => `<div>${detail}</div>`).join('')}
      </div>
    </article>
  `).join('');

  if (changelogCount) {
    changelogCount.textContent = `${entries.length} 条记录`;
  }
}

function renderReleaseSummary() {
  if (!releaseSummary || CHANGELOG_ENTRIES.length === 0) return;
  const latest = CHANGELOG_ENTRIES[0];
  releaseSummary.innerHTML = `
    <div>
      <strong>${latest.version || latest.date}</strong>
      <span>${latest.summary}</span>
    </div>
    <a class="btn btn-secondary" href="/help">查看帮助</a>
  `;
}

function initMonthFilter() {
  if (!monthFilter) return;
  const months = [...new Set(CHANGELOG_ENTRIES.map((entry) => entry.month || entry.date.slice(0, 7)))];
  monthFilter.innerHTML = [
    '<option value="all">全部月份</option>',
    ...months.map((month) => `<option value="${month}">${month}</option>`)
  ].join('');

  monthFilter.addEventListener('change', () => {
    const value = monthFilter.value;
    const entries = value === 'all'
      ? CHANGELOG_ENTRIES
      : CHANGELOG_ENTRIES.filter((entry) => (entry.month || entry.date.slice(0, 7)) === value);
    renderTimeline(entries);
  });
}

renderReleaseSummary();
initMonthFilter();
renderTimeline(CHANGELOG_ENTRIES);
