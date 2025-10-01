package directory_client

type DirectoryClient interface {
	Create(path string, permissions string) (string, error) // Base of the newly created path (used in destroy), error
	// If directory isn't found the error message must have err.Error() == "directory not found"
	Read(path string) (string, map[string]map[string]string, error) // permissions, files info map, error
	Update(path string, permissions string) error
	Delete(path string) error // "path" should be the return from Create
	CreateFile(path string, data string, permissions string, lastModified string) error // create a file in the given directory
}
