package boilerplate

import (
	"fmt"
)

// Implements
// type boilerplateClient interface {
// 	Create(id string) error
// 	Read(id string) (string, error)
// 	Update(id string) error
// 	Delete(id string) error
// }

type defaultBoilerplateClient struct {
	someObject map[string]string
}

var _ boilerplateClient = &defaultBoilerplateClient{} // make sure we implement the boilerplateClient properly

func (c *defaultBoilerplateClient) Create(id string) error {
	c.someObject = make(map[string]string)
	c.someObject["id"] = id
	return nil
}

func (c *defaultBoilerplateClient) Read(id string) (string, error) {
	if c.someObject["id"] == "" {
		return "", fmt.Errorf("some obj not found")
	}
	return c.someObject["id"], nil
}

func (c *defaultBoilerplateClient) Update(id string) error {
	c.someObject["id"] = id
	return nil
}

func (c *defaultBoilerplateClient) Delete(id string) error {
	c.someObject = nil
	return nil
}
