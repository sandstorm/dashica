import {html} from "htl";
import * as Inputs from "@observablehq/inputs";
import {replaceStateParam} from "../util/url.js";

const name = "globalTimeSelector";
const spacingX = (factor: number) => html`
    <div style="width: ${factor * 5}px;"></div>`;


export function globalTimeSelector() {
    const urlParams = new URLSearchParams(window.location.search);

    const fromParam = urlParams.get('from');
    const toParam = urlParams.get('to');

    let presetFromUrlOrDefault = _defaultPreset;
    let fromDateInputValue: Date|undefined = undefined;
    let toDateInputValue: Date|undefined = undefined;
    if (fromParam && toParam) {
        // we fall back to _emptyPreset if from and to are set, but we do not find a preset for it - because it is a timestamp very likely.
        const foundPreset = findPresetMatchingFromTo(fromParam, toParam);
        console.log("foundPreset", foundPreset);

        if (foundPreset) {
            presetFromUrlOrDefault = foundPreset;
        } else {
            // from and to are date inputs
            presetFromUrlOrDefault = _emptyPreset;
            fromDateInputValue = new Date(parseInt(fromParam) * 1000);
            toDateInputValue = new Date(parseInt(toParam) * 1000);
        }
    }

    const presetInput = Inputs.select<IntervalPreset>(presets, {
        keyof: (preset) => preset.label,
        value: presetFromUrlOrDefault,
    })

    const fromDateInput = Inputs.datetime({value: fromDateInputValue})
    const toDateInput = Inputs.datetime({value: toDateInputValue})
    const applyButton = Inputs.button("Apply")

    const root = html`<div class="globalTimeSelector" style="display: flex; align-items: start">
        ${stopPropagation(presetInput)}

        ${spacingX(2)}
        or
        ${spacingX(2)}

        <div style="display: flex;">
            <div class="globalTimeSelector__from">${stopPropagation(fromDateInput)}</div>
            ${spacingX(2)}
            <div class="globalTimeSelector__to">${stopPropagation(toDateInput)}</div>
            ${spacingX(2)}
            <div class="globalTimeSelector__apply">${stopPropagation(applyButton)}</div>
        </div>
    </div>`;

    presetInput.addEventListener('input', (event: Event) => {
        window.dispatchEvent(new CustomEvent('dashica-stop-all-running-filter-requests'));
        fromDateInputValue = undefined;
        toDateInputValue = undefined;
        replaceStateParam('from', presetInput.value.from);
        replaceStateParam('to', presetInput.value.to);
        root.dispatchEvent(new CustomEvent("input", { bubbles: true }));
    });

    function handleApply() {
        if (fromDateInput.value && toDateInput.value) {
            window.dispatchEvent(new CustomEvent('dashica-stop-all-running-filter-requests'));
            presetInput.value = _emptyPreset;

            fromDateInputValue = fromDateInput.value;
            toDateInputValue = toDateInput.value;

            replaceStateParam('from', toUnixTimestamp(fromDateInputValue));
            replaceStateParam('to', toUnixTimestamp(toDateInputValue));
            root.dispatchEvent(new CustomEvent("input", { bubbles: true }));
        }
    }
    applyButton.addEventListener('input', handleApply);
    Object.defineProperty(root, "value", {
        get() {
            console.log("FDI", fromDateInput.value);
            return {
                from: fromDateInputValue ? toUnixTimestamp(fromDateInputValue) : presetInput.value.from,
                to: toDateInputValue ? toUnixTimestamp(toDateInputValue) : presetInput.value.to
            };
        },
        set(value) {
            throw new Error("not implemented");
        }
    });

    // @ts-ignore
    window.addEventListener('dashica-set-time', (event: CustomEvent<{ from: Date, to: Date }>) => {
        fromDateInput.value = event.detail.from;
        toDateInput.value = event.detail.to;
        handleApply();
    });

    return root;
}

function stopPropagation(el: HTMLElement) {
    const root = html`<span>${el}</span>`;
    root.addEventListener('input', (event) => event.stopPropagation());
    return root;
}

interface IntervalPreset {
    label: string;
    from: string;
    to: string;
}

const _emptyPreset: IntervalPreset = {label: "custom", from: "", to: ""};
const _defaultPreset: IntervalPreset = {label: "last 24 hours", from: "now() - INTERVAL 1 DAY", to: "now()"};

function findPresetMatchingFromTo(from: string, to: string) {
    return presets.find((preset) => preset.from === from && preset.to === to);
}

const presets: IntervalPreset[] = [
    _emptyPreset,
    {label: "last 5 minutes", from: "now() - INTERVAL 5 MINUTE", to: "now()"},
    {label: "last 15 minutes", from: "now() - INTERVAL 15 MINUTE", to: "now()"},
    {label: "last 60 minutes", from: "now() - INTERVAL 60 MINUTE", to: "now()"},
    {label: "last 3 hours", from: "now() - INTERVAL 3 HOUR", to: "now()"},
    {label: "last 6 hours", from: "now() - INTERVAL 6 HOUR", to: "now()"},
    {label: "last 12 hours", from: "now() - INTERVAL 12 HOUR", to: "now()"},
    _defaultPreset,
    {label: "last 2 days", from: "now() - INTERVAL 2 DAY", to: "now()"},
    {label: "last 7 days", from: "now() - INTERVAL 7 DAY", to: "now()"},
    {label: "last 30 days", from: "now() - INTERVAL 30 DAY", to: "now()"},
];

function toUnixTimestamp(d: Date) {
    return Math.floor(d.getTime() / 1000);
}
