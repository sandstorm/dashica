document.addEventListener('DOMContentLoaded', function () {
    const STORAGE_KEY = 'dashica_favorites';
    const CURRENT_URL = window.location.pathname;

    function load() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
        catch { return []; }
    }

    function save(favs) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
    }

    function isFav(url) {
        return load().some(f => f.url === url);
    }

    function toggle(url, title) {
        const favs = load();
        const idx = favs.findIndex(f => f.url === url);
        if (idx >= 0) { favs.splice(idx, 1); } else { favs.push({ url, title }); }
        save(favs);
        refresh();
    }

    function renderGroup() {
        document.getElementById('favorites-group')?.remove();
        const favs = load();
        if (!favs.length) return;

        const menu = document.querySelector('.application__sidebar ul.menu');
        if (!menu) return;

        const li = document.createElement('li');
        li.id = 'favorites-group';

        const h2 = document.createElement('h2');
        h2.className = 'menu-title';
        h2.textContent = 'Favorites';

        const ul = document.createElement('ul');
        favs.forEach(fav => {
            const a = document.createElement('a');
            a.href = fav.url;
            a.textContent = fav.title;
            if (fav.url === CURRENT_URL) { a.classList.add('menu-active'); }
            const item = document.createElement('li');
            item.appendChild(a);
            ul.appendChild(item);
        });

        li.append(h2, ul);
        menu.prepend(li);
    }

    function updateButtons() {
        document.querySelectorAll('.star-btn[data-url]').forEach(btn => {
            const fav = isFav(btn.dataset.url);
            btn.textContent = fav ? '★' : '☆';
            btn.classList.toggle('star-btn--active', fav);
            btn.title = fav ? 'Remove from favorites' : 'Add to favorites';
        });
    }

    function refresh() {
        renderGroup();
        updateButtons();
    }

    document.querySelectorAll('.star-btn[data-url]').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            toggle(btn.dataset.url, btn.dataset.title);
        });
    });

    updateButtons();
    renderGroup();
});
