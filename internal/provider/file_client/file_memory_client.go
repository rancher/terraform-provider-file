package file_client

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"path/filepath"
)

type MemoryFileClient struct {
	file map[string]string
}

var _ FileClient = &MemoryFileClient{} // make sure the MemoryFileClient implements the FileClient

func (c *MemoryFileClient) Create(directory string, name string, data string, permissions string) error {

	c.file = make(map[string]string)
	c.file["directory"] = directory
	c.file["name"] = name
	c.file["contents"] = data
	c.file["permissions"] = permissions
	return nil
}

func (c *MemoryFileClient) Read(directory string, name string) (string, string, error) {
	if c.file["directory"] == "" || c.file["name"] == "" {
		return "", "", fmt.Errorf("file not found")
	}
	return c.file["permissions"], c.file["contents"], nil
}

func (c *MemoryFileClient) Update(currentDirectory string, currentName string, newDirectory string, newName string, data string, permissions string) error {
	c.file["directory"] = newDirectory
	c.file["name"] = newName
	c.file["contents"] = data
	c.file["permissions"] = permissions
	c.file["compressed"] = "false"
	return nil
}

func (c *MemoryFileClient) Delete(directory string, name string) error {
	if c.file["directory"] == directory && c.file["name"] == name {
		c.file = nil
	}
	return nil
}

func (c *MemoryFileClient) Encode(directory string, name string, encodedName string) error {
	contents := []byte(c.file["contents"])
	encoded := make([]byte, base64.StdEncoding.EncodedLen(len(contents)))
	base64.StdEncoding.Encode(encoded, contents)
	c.file["contents"] = string(encoded)
	return nil
}

func (c *MemoryFileClient) Compress(directory string, name string, compressedName string) error {
	c.file["compressed"] = "true"
	contents := []byte(c.file["contents"])
	var compressedBuffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&compressedBuffer)
	_, err := gzipWriter.Write(contents)
	if err != nil {
		return err
	}
	if err := gzipWriter.Close(); err != nil {
		return err
	}
	contents = compressedBuffer.Bytes()
	c.file["content"] = string(contents)
	return nil
}

func (c *MemoryFileClient) Hash(directory string, name string) (string, error) {
	contents := []byte(c.file["contents"])

	hasher := sha256.New()
	hasher.Write(contents)
	hashBytes := hasher.Sum(nil)
	hashString := hex.EncodeToString(hashBytes)

	return hashString, nil
}

func (c *MemoryFileClient) Copy(currentPath string, newPath string) error {
	c.file["directory"] = filepath.Dir(newPath)
	c.file["name"] = filepath.Base(newPath)
	return nil
}
