// UNMIGRATED (workbench): port, rewrite or delete, then remove this line. See docs/2026-10-28-workbench.md §5.
document.addEventListener('DOMContentLoaded', function () {
    var sidebar = document.querySelector('.application__sidebar');
    if (!sidebar) { return; }
    var saved = sessionStorage.getItem('sidebarScrollTop');
    if (saved) { sidebar.scrollTop = parseInt(saved, 10); }
    sidebar.addEventListener('scroll', function () {
        sessionStorage.setItem('sidebarScrollTop', String(sidebar.scrollTop));
    });
});
