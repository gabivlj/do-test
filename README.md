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

There is also two versions, the srs with SQLITE (./do-srs), and the non-SQLITE one.

## How it works

You can send chunks to an index by using -X POST.

```
curl <url>/<namespace>/<chunk> -X POST -d 'somedata'

```

You can also retrieve it:

```
curl <url>/<namespace>/<chunk>

```

Then in the root of the repo, you can configure the go program to run however you want.
Just make sure that if you change the chunk size in both the go code and the typescript code, and redeploy.
The chunk size defines how much data is set in a single value.
