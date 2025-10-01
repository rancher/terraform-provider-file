package directory_client

import (
	"fmt"
  "path/filepath"
  "strings"
)

var _ DirectoryClient = &MemoryDirectoryClient{} // make sure the MemoryDirectoryClient implements the DirectoryClient

type MemoryDirectoryClient struct {
	directory map[string]interface{}
}

func (c *MemoryDirectoryClient) Create(path string, permissions string) (string, error) {

  path = filepath.Clean(path)
  var base string
  if filepath.IsAbs(path) {
    base = filepath.VolumeName(path) + string(filepath.Separator)
  } else {
    p := strings.Split(path, string(filepath.Separator))
    base = p[0]
  }

  c.directory = make(map[string]interface{})
	c.directory["permissions"] = permissions
	c.directory["path"]        = path
	c.directory["base"]        = base
  c.directory["info"]        = map[string]map[string]string{}
	return base, nil
}

func (c *MemoryDirectoryClient) Read(path string) (string, map[string]map[string]string, error) {
  if c.directory == nil {
    return "", nil, fmt.Errorf("directory not found")
  }
  permissions, _ := c.directory["permissions"].(string)
  info, _ := c.directory["info"].(map[string]map[string]string)
	return permissions, info, nil
}

func (c *MemoryDirectoryClient) Update(path string, permissions string) error {
	c.directory["permissions"] = permissions
	return nil
}

func (c *MemoryDirectoryClient) Delete(path string) error {
	c.directory = nil
	return nil
}

func (c *MemoryDirectoryClient) CreateFile(path string, data string, permissions string, lastModified string) error {
	if c.directory == nil {
		return fmt.Errorf("directory not found")
	}
	c.directory["info"].(map[string]map[string]string)[path] = map[string]string{
		"Size":    fmt.Sprintf("%d", len(data)),
		"Mode":    permissions,
		"ModTime": lastModified,
		"IsDir":   "false",
	}
	return nil
}
