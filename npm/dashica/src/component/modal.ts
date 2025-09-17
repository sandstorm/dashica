import {html} from "htl";

export function modal(trigger: HTMLElement|string, content: HTMLElement|string) {
    return html`
        <div x-data="{}">
            <!-- Trigger -->
            <a x-on:click="$refs.dialog.showModal()">
                ${trigger}
            </a>

            <dialog class="modal" x-ref="dialog">
                ${content}
                <iconify-icon class="modal__close" x-on:click="$refs.dialog.close()"  icon="material-symbols:close" width="24" height="24" />
            </dialog>
        </div>`;
}