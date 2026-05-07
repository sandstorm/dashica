const STORAGE_KEY = 'dashica_favorites';

export default function favorites() {
    return {
        items: [],
        currentUrl: window.location.pathname,

        init() {
            try {
                this.items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            } catch {
                this.items = [];
            }
        },

        isFav(url) {
            return this.items.some(f => f.url === url);
        },

        toggle(url, title) {
            const idx = this.items.findIndex(f => f.url === url);
            if (idx >= 0) {
                this.items.splice(idx, 1);
            } else {
                this.items.push({ url, title });
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
        },
    };
}
