export function test(generator: AsyncGenerator) {
    console.log("JAAA", generator);
    // TODO: fetch generator and refresh div with generated value??

    const el = document.createElement('div');
    el.innerHTML = 'STUFF from test()';

    processGeneratorAsync(generator, el);
    return el;
}

// Separate async function to handle the generator processing
async function processGeneratorAsync(generator: AsyncGenerator, containerEl: HTMLElement) {
    try {
        for await (const value of generator) {
            console.log("ITER GEN");
            // Update the container with each new value
            containerEl.innerHTML = `Generated value: ${JSON.stringify(value)}`;

            // Or to append instead of replace:
            // const valueEl = document.createElement('p');
            // valueEl.textContent = `Generated value: ${JSON.stringify(value)}`;
            // containerEl.appendChild(valueEl);
        }

        // Add completion message when generator is done
        const completionMsg = document.createElement('p');
        completionMsg.textContent = 'Generator completed';
        containerEl.appendChild(completionMsg);
    } catch (error) {
        // Handle errors
        const errorEl = document.createElement('p');
        errorEl.className = 'error';
        errorEl.textContent = `Error processing generator: ${error.message}`;
        containerEl.appendChild(errorEl);
    }
}


export function observableMulticast(generatorFunc) {
    // Shared state - will be used by all derived cells
    const cache = [];
    let isDone = false;
    let error = null;
    let currentPromise = null;

    // The source generator - only created once
    let sourceIterator = null;

    // Function to pull the next value (used internally)
    async function pullNext() {
        if (currentPromise || isDone) return currentPromise;

        currentPromise = (async () => {
            try {
                // Lazy initialization
                if (!sourceIterator) {
                    sourceIterator = generatorFunc[Symbol.asyncIterator]();
                }

                const result = await sourceIterator.next();

                if (result.done) {
                    isDone = true;
                } else {
                    cache.push(result.value);
                }

                return cache.length - 1;
            } catch (e) {
                error = e;
                isDone = true;
                throw e;
            } finally {
                currentPromise = null;
            }
        })();

        return currentPromise;
    }

    // Create a consumer factory that can be used in Observable cells
    return {
        // Getter for the latest value - aligns with standard Observable pattern
        get value() {
            return cache.length > 0 ? cache[cache.length - 1] : undefined;
        },
        // Method to create a reactive consumer at a specific position
        at: async function(index) {
            if (index < 0) throw new Error("Index cannot be negative");

            // If requested index is already in cache
            if (index < cache.length) {
                return cache[index];
            }

            // If stream is done and index is beyond available data
            if (isDone && index >= cache.length) {
                return undefined;
            }

            // Need to pull more data
            while (!isDone && index >= cache.length) {
                await pullNext();
            }

            return index < cache.length ? cache[index] : undefined;
        },

        // Get all available values up to now (reactive)
        get values() {
            // This automatically becomes reactive in Observable
            return [...cache];
        },

        // Method to create an async iterator (for use with for-await)
        subscribe: function() {
            let position = 0;

            return {
                [Symbol.asyncIterator]() {
                    return {
                        async next() {
                            if (error) throw error;

                            if (position < cache.length) {
                                return { value: cache[position++], done: false };
                            }

                            if (isDone) {
                                return { done: true };
                            }

                            await pullNext();
                            return this.next();
                        }
                    };
                }
            };
        },

        // Check if the generator is completed
        get done() {
            return isDone;
        },

        // Force-advance the generator (useful for triggering side effects)
        advance: pullNext
    };
}