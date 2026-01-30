import Alpine from '@alpinejs/csp';

Alpine.data('debugDrawer', () => ({

    visible: false,

    init() {
        this.$el.addEventListener('dashica-debugDrawer-toggle', (e) => {
            this.visible = !this.visible

            if (this.visible) {
                if (e.detail?.queryResult?.clickhouseSummary) {
                    this.$refs.clickhouseSummary.innerText = JSON.stringify(e.detail?.queryResult?.clickhouseSummary, null,'    ');
                }

            }
            console.log('show debug drawer', e.detail.queryResult.clickhouseSummary)
        });
    },
}))