# DO perf testing

To test

```
cd do-test && pnpm run deploy
```

```
# In root of the repo
go run .
```

## Concepts

Chunk size in this repo refers to the size of the value that the DO will store in a key value.

```
    // in the typescript code
    const chunkSize = 4096;
```

```
    // In the go code
    const chunkSize = 4096
```
