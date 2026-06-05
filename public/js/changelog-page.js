import { CHANGELOG_ENTRIES } from '/js/changelog-data.js?v=20260605-enhance-search-details-v4';

const timeline = document.getElementById('timeline');
const totalVersions = document.getElementById('total-versions');
const totalFeatures = document.getElementById('total-features');
const latestDate = document.getElementById('latest-date');

if (totalVersions) totalVersions.textContent = CHANGELOG_ENTRIES.length;
if (totalFeatures) totalFeatures.textContent = CHANGELOG_ENTRIES.reduce((sum, entry) => sum + (entry.details?.length || 0), 0);
if (latestDate && CHANGELOG_ENTRIES.length > 0) latestDate.textContent = CHANGELOG_ENTRIES[0].date;

if (timeline) {
  timeline.innerHTML = CHANGELOG_ENTRIES.map((entry) => `
    <article class="entry">
      <div class="entry-date">${entry.date}</div>
      <h2>${entry.title}</h2>
      <p>${entry.summary}</p>
      <div class="entry-list">
        ${(entry.details || []).map((detail) => `<div>${detail}</div>`).join('')}
      </div>
    </article>
  `).join('');
}
