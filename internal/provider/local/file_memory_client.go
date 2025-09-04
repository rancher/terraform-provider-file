package local

import (
	"fmt"
)

type memoryFileClient struct {
	file map[string]string
}

var _ fileClient = &memoryFileClient{} // make sure the memoryFileClient implements the fileClient

func (c *memoryFileClient) Create(directory string, name string, data string, permissions string) error {

	c.file = make(map[string]string)
	c.file["directory"] = directory
	c.file["name"] = name
	c.file["contents"] = data
	c.file["permissions"] = permissions
	return nil
}

func (c *memoryFileClient) Read(directory string, name string) (string, string, error) {
	if c.file["directory"] == "" || c.file["name"] == "" {
		return "", "", fmt.Errorf("file not found")
	}
	return c.file["permissions"], c.file["contents"], nil
}

func (c *memoryFileClient) Update(currentDirectory string, currentName string, newDirectory string, newName string, data string, permissions string) error {
	c.file["directory"] = newDirectory
	c.file["name"] = newName
	c.file["contents"] = data
	c.file["permissions"] = permissions
	return nil
}

func (c *memoryFileClient) Delete(directory string, name string) error {
	c.file = nil
	return nil
}
