import {basicSetup} from "codemirror"
import {EditorView, keymap} from "@codemirror/view"

import {Prec, EditorState} from "@codemirror/state"
import {sql} from "@codemirror/lang-sql"
import type {ClickhouseSchema} from "../clickhouse.js";
import {html} from "htl";
import {getStateParam, replaceStateParam} from "../util/url.js";

export function sqlFilterInput(schema: ClickhouseSchema) {
    const editorWrapper = html`<div class="sqlFilterInput__editor"></div>`
    const root = html`<div class="sqlFilterInput">${editorWrapper}<div class="sqlFilterInput__help">ENTER to submit query. Double-click on table cells to add conditions to the SQL string.</div></div></div>` as HTMLElement & {value: string};

    let lastDocOnEnter = "";
    const initialState = EditorState.create({
        extensions: [
            basicSetup,
            sql({
                schema: schema.commonColumns.reduce((acc, column) => ({...acc, [column]: []}), {})
            }),
            EditorState.tabSize.of(2),
            // Add a custom keymap to handle the Enter key
            Prec.highest(keymap.of([{
                key: "Enter",
                run: (view) => {
                    lastDocOnEnter = view.state.doc.toString();

                    window.dispatchEvent(new CustomEvent('dashica-stop-all-running-filter-requests'));
                    root.dispatchEvent(new CustomEvent("input", { bubbles: true }));
                    replaceStateParam('sql', lastDocOnEnter);
                    // Return true to prevent the default Enter behavior
                    return true;
                }
            }]))
        ]
    });

    const myView = new EditorView({
        state: initialState,
        parent: editorWrapper
    });


    Object.defineProperty(root, "value", {
        get() {
            return lastDocOnEnter;
        },
        set(value) {
            const transaction = myView.state.update({
                changes: {
                    from: 0,
                    to: myView.state.doc.length,
                    insert: value
                }
            });
            lastDocOnEnter = value;
            myView.dispatch(transaction);
            replaceStateParam('sql', lastDocOnEnter);
        }
    });

    const sqlState = getStateParam('sql');
    if (sqlState) {
        root.value = sqlState;
    }

    // @ts-ignore
    window.addEventListener('dashica-add-filter', (event: CustomEvent<string>) => {
        let content = root.value;

        if (content.trim().length > 0) {
            content += '\n AND ';
        }
        content += event.detail;

        root.value = content;
        window.dispatchEvent(new CustomEvent('dashica-stop-all-running-filter-requests'));
        window.setTimeout(() =>
            root.dispatchEvent(new CustomEvent("input", { bubbles: true }))
            , 5)

    });

    return root;
}
