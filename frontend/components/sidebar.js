document.addEventListener('DOMContentLoaded', function () {
    var sidebar = document.querySelector('.application__sidebar');
    if (!sidebar) { return; }
    var saved = sessionStorage.getItem('sidebarScrollTop');
    if (saved) { sidebar.scrollTop = parseInt(saved, 10); }
    sidebar.addEventListener('scroll', function () {
        sessionStorage.setItem('sidebarScrollTop', String(sidebar.scrollTop));
    });
});
