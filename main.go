package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"
)

func getRandomBytes(n int) ([]byte, error) {
	bytes := make([]byte, n)
	_, err := rand.Read(bytes)
	if err != nil {
		return nil, err
	}

	return bytes, nil
}

type config struct {
	// url is the url to the block DO API
	url string
	// totalChunks is the total number of chunks we are going to send to the DO
	totalChunks int64
}

type CallConfig struct {
	// ChunkSizeBytes is the chunk size we are going to use to send to the DO
	ChunkSizeBytes int64

	// ChunksPerCall is the number of chunks we are going to send to the DO in a single call
	ChunksPerCall int64
}

// Put here the chunk size you want to use. Make sure it matches with your DO chunk size configuration
// Chunk size max is 128 * 1024
const chunkSize = 128 * 1024

func must[T any](t T, err error) T {
	assert("expected action to be successful", err)
	return t
}

func assert(msg string, err error) {
	if err != nil {
		panic(fmt.Sprintf("%s: %+v", msg, err))
	}
}

type result struct {
	AvgTimePerPush            string
	Error                     string
	TotalTimePush             string
	TotalDataTransferredBytes int64
	ConcurrentJobs            int
	ConfigUsed                CallConfig
}

func main() {
	results := []result{}
	conf := config{
		url: "",
		// Set here how many chunks you want to send per test
		// The total data that its going to get sent per test is:
		//  totalChunks * doValueSize
		totalChunks: 200,
	}

	resultsC := make(chan result, conf.totalChunks*conf.totalChunks)
	maxConcurrentChunkPushes := 5
	uploadTokenC := make(chan struct{}, maxConcurrentChunkPushes)
	for i := 0; i < maxConcurrentChunkPushes; i++ {
		uploadTokenC <- struct{}{}
	}

	go func() {
		for result := range resultsC {
			results = append(results, result)
		}
	}()

	// Put here the location of the DO
	locationHint := "wnam"

	// Try to send 1, 10, 20, 30, 40 chunks at once on each test
	for i := 0; i <= 50; i += 10 {
		index := i
		if i == 0 {
			index = 1
		}

		wg := sync.WaitGroup{}
		c := &CallConfig{
			ChunkSizeBytes: chunkSize,
			ChunksPerCall:  int64(index),
		}

		client := &http.Client{}
		base := must(url.JoinPath(conf.url, locationHint+"-location"))
		entireOp := time.Now()
		calls := atomic.Uint64{}
		ops := 0
		for chunkIndex := int64(0); chunkIndex < conf.totalChunks; chunkIndex += c.ChunksPerCall {
			chunkIndex := chunkIndex
			ops++
			wg.Add(1)
			go func() {
				<-uploadTokenC
				defer func() {
					uploadTokenC <- struct{}{}
					wg.Done()
				}()

				max := chunkIndex + c.ChunksPerCall
				if max > conf.totalChunks {
					max = conf.totalChunks
				}

				u := must(url.JoinPath(base, fmt.Sprintf("%d,%d", chunkIndex, max-1)))
				randomData, err := getRandomBytes(int(c.ChunkSizeBytes) * int(c.ChunksPerCall))
				assert("random bytes", err)
				randomDataBuf := bytes.NewBuffer(randomData)
				req, err := http.NewRequest("PUT", u, randomDataBuf)
				assert("creating request", err)
				req.Header.Add("X-Location-Hint", locationHint)
				assert("getting random data", err)
				now := time.Now()
				res, err := client.Do(req)
				assert("uploading some chunk", err)
				if res.StatusCode != 200 {
					b, err := io.ReadAll(res.Body)
					if err != nil {
						b = []byte(fmt.Sprintf("<couldnt read body>: %v", err))
					}

					res.Body.Close()
					resultsC <- result{Error: fmt.Sprintf("status code is not 200: %+v", errors.New(string(b)))}
					return
				}

				res.Body.Close()

				calls.Add(uint64(time.Since(now)))
				log.Println("Uploading bytes took", time.Since(now), "of chunk", chunkIndex, "-", max-1)
			}()
		}

		wg.Wait()
		carry := 0
		if conf.totalChunks%c.ChunksPerCall != 0 {
			carry++
		}

		results = append(results, result{
			ConfigUsed:                *c,
			AvgTimePerPush:            time.Duration(calls.Load() / uint64(ops)).String(),
			TotalTimePush:             time.Since(entireOp).String(),
			TotalDataTransferredBytes: conf.totalChunks * c.ChunkSizeBytes,
			ConcurrentJobs:            maxConcurrentChunkPushes,
		})
		log.Println("OK, entire operation took", time.Since(entireOp))
		log.Println("Sent", c.ChunkSizeBytes*conf.totalChunks, "bytes in", c.ChunksPerCall*c.ChunkSizeBytes, "bytes sent per call")
	}

	close(resultsC)
	resultsJSON, err := json.MarshalIndent(results, "", "\t")
	assert("marshaling results to JSON", err)
	log.Println(string(resultsJSON))
}
