package file_client

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// The default FileClient, using the os package.
type OsFileClient struct{}

var _ FileClient = &OsFileClient{} // make sure the OsFileClient implements the FileClient

func (c *OsFileClient) Create(directory string, name string, data string, permissions string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during file creation: %v", r)
		}
	}()

	path := filepath.Join(directory, name)
	modeInt, err := strconv.ParseUint(permissions, 8, 32)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, os.FileMode(modeInt))
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.WriteString(f, data)
	return err
}

func (c *OsFileClient) Read(directory string, name string) (rMode string, rContents string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during file read: %v", r)
		}
	}()

	path := filepath.Join(directory, name)
	info, err := os.Stat(path)
	if err != nil && os.IsNotExist(err) {
		return "", "", fmt.Errorf("file not found")
	}
	if err != nil {
		return "", "", err
	}
	mode := fmt.Sprintf("%#o", info.Mode().Perm())
	f, err := os.Open(path)
	if err != nil {
		return "", "", err
	}
	defer f.Close()
	var builder strings.Builder
	builder.Grow(int(info.Size()))
	if _, err = io.Copy(&builder, f); err != nil {
		return "", "", err
	}
	return mode, builder.String(), nil
}

func (c *OsFileClient) Update(currentDirectory string, currentName string, newDirectory string, newName string, data string, permissions string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during file update: %v", r)
		}
	}()

	currentPath := filepath.Join(currentDirectory, currentName)
	newPath := filepath.Join(newDirectory, newName)
	if currentPath != newPath {
		err = os.Rename(currentPath, newPath)
		if err != nil {
			return err
		}
	}
	modeInt, err := strconv.ParseUint(permissions, 8, 32)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(newPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, os.FileMode(modeInt))
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.WriteString(f, data)
	return err
}

func (c *OsFileClient) Delete(directory string, name string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during file deletion: %v", r)
		}
	}()

	path := filepath.Join(directory, name)
	return os.RemoveAll(path)
}

func (c *OsFileClient) Compress(directory string, name string, outputName string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during file compression: %v", r)
		}
	}()

	inFilePath := filepath.Join(directory, name)
	inFile, err := os.Open(inFilePath)
	if err != nil {
		return err
	}
	defer inFile.Close()

	// Create a tmp file to hold compressed data during conversion
	outFilePath := filepath.Join(directory, outputName)
	outFile, err := os.Create(outFilePath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	// copy inFile to gzip writer, which writes to outFile
	// use the best compression ratio possible
	gzipWriter, err := gzip.NewWriterLevel(outFile, gzip.BestCompression)
	if err != nil {
		return err
	}
	_, err = io.Copy(gzipWriter, inFile)
	if err != nil {
		return err
	}

	return gzipWriter.Close()
}

// base64 encodes a file.
func (c *OsFileClient) Encode(directory string, name string, outputName string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during file encoding: %v", r)
		}
	}()

	inFilePath := filepath.Join(directory, name)
	inFile, err := os.Open(inFilePath)
	if err != nil {
		return err
	}
	defer inFile.Close()

	// Create a tmp file to hold encoded data during conversion
	outFilePath := filepath.Join(directory, outputName)
	outFile, err := os.Create(outFilePath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	// Copy writes to the base64Encoder, which writes to the outFile
	base64Encoder := base64.NewEncoder(base64.StdEncoding, outFile)
	_, err = io.Copy(base64Encoder, inFile)
	if err != nil {
		return err
	}

	return base64Encoder.Close()
}

// get the sha256 hash of the file, formatted as hex.
func (c *OsFileClient) Hash(directory string, name string) (hashStr string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during file hashing: %v", r)
		}
	}()

	filePath := filepath.Join(directory, name)
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hasher := sha256.New()
	_, err = io.Copy(hasher, file)
	if err != nil {
		return "", err
	}
	contentsHash := hasher.Sum(nil)
	hexContents := hex.EncodeToString(contentsHash)
	return hexContents, nil
}

func (c *OsFileClient) Copy(currentPath string, newPath string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during file copy: %v", r)
		}
	}()

	srcFile, err := os.Open(currentPath)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	destFile, err := os.Create(newPath)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, srcFile)
	if err != nil {
		return err
	}

	return nil
}
