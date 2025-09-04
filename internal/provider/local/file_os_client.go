package local

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// The default fileClient, using the os package.
type osFileClient struct{}

var _ fileClient = &osFileClient{} // make sure the osFileClient implements the fileClient

func (c *osFileClient) Create(directory string, name string, data string, permissions string) error {
	path := filepath.Join(directory, name)
	modeInt, err := strconv.ParseUint(permissions, 8, 32)
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(data), os.FileMode(modeInt))
}

func (c *osFileClient) Read(directory string, name string) (string, string, error) {
	path := filepath.Join(directory, name)
	info, err := os.Stat(path)
	if err != nil && os.IsNotExist(err) {
		return "", "", fmt.Errorf("file not found")
	}
	if err != nil {
		return "", "", err
	}
	mode := fmt.Sprintf("%#o", info.Mode().Perm())
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	return mode, string(contents), nil
}

func (c *osFileClient) Update(currentDirectory string, currentName string, newDirectory string, newName string, data string, permissions string) error {
	currentPath := filepath.Join(currentDirectory, currentName)
	newPath := filepath.Join(newDirectory, newName)
	if currentPath != newPath {
		err := os.Rename(currentPath, newPath)
		if err != nil {
			return err
		}
	}
	modeInt, err := strconv.ParseUint(permissions, 8, 32)
	if err != nil {
		return err
	}
	if err = os.WriteFile(newPath, []byte(data), os.FileMode(modeInt)); err != nil {
		return err
	}
	return nil
}

func (c *osFileClient) Delete(directory string, name string) error {
	path := filepath.Join(directory, name)
	return os.Remove(path)
}
