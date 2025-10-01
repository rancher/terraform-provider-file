package file_client

type FileClient interface {
	Create(directory string, name string, data string, permissions string) error
	// If file isn't found the error message must have err.Error() == "file not found"
	Read(directory string, name string) (string, string, error) // permissions, contents, error
	Update(currentDirectory string, currentName string, newDirectory string, newName string, data string, permissions string) error
	Delete(directory string, name string) error

	Compress(directory string, name string, compressedName string) error
	Encode(directory string, name string, encodedName string) error
	Hash(directory string, name string) (string, error) // Sha256Hash, error
}
