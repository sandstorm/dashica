export default function sidebarSearch() {
    return {
        query: '',

        init() {
            this.filter();
        },

        focus() {
            this.$refs.searchInput.focus();
            this.$refs.searchInput.select();
        },

        clear() {
            this.query = '';
            this.filter();
            this.$refs.searchInput.blur();
        },

        filter() {
            const q = this.query.trim().toLowerCase();
            const root = this.$root;
            let anyVisible = false;

            root.querySelectorAll('[data-menu-group]').forEach(group => {
                const groupTitle = (group.dataset.menuGroup || '').toLowerCase();
                const groupMatches = q === '' || groupTitle.includes(q);

                let visibleCount = 0;
                group.querySelectorAll('[data-menu-entry]').forEach(entry => {
                    const title = (entry.dataset.menuEntry || '').toLowerCase();
                    const show = q === '' || groupMatches || title.includes(q);
                    entry.hidden = !show;
                    if (show) visibleCount++;
                });

                const showGroup = q === '' || groupMatches || visibleCount > 0;
                group.hidden = !showGroup;
                if (showGroup) anyVisible = true;
            });

            // $refs may not be registered yet during init(); guard the access.
            if (this.$refs.noResults) {
                this.$refs.noResults.hidden = q === '' || anyVisible;
            }
        },
    };
}
