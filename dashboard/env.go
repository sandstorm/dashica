package dashboard

import (
	"log"
	"os"
	"path/filepath"
	"strings"
)

type DashboardEnv struct {
	PageLoaderScript string
}

func (e DashboardEnv) WriteSqlScript(queryName string, query string) {
	fullScriptPath := e.SqlScriptPath(queryName)
	err := os.MkdirAll(filepath.Dir(fullScriptPath), 0755)
	if err != nil {
		log.Fatalln("Cannot create dir: ", err)
	}
	err = os.WriteFile(fullScriptPath, []byte(query), 0644)
	if err != nil {
		log.Fatalln("Cannot create dir: ", err)
	}
}

func (e DashboardEnv) SqlScriptPath(queryName string) string {
	scriptName := filepath.Base(e.PageLoaderScript)
	// suffix is like ".md.go"
	scriptName = strings.TrimSuffix(scriptName, filepath.Ext(scriptName))
	scriptName = strings.TrimSuffix(scriptName, filepath.Ext(scriptName))
	finalFilePath := filepath.Join(filepath.Dir(e.PageLoaderScript), scriptName, queryName+".sql")

	return finalFilePath
}

func LoadEnv() DashboardEnv {
	if len(os.Args) != 3 {
		log.Fatalln("Not called through golang-script task. aborting, as context dir is not set.")
	}
	targetWd := os.Args[1]
	err := os.Chdir(targetWd)
	if err != nil {
		log.Fatalln("Cannot switch working dir: ", err)
	}

	targetFile := os.Args[2]
	return DashboardEnv{
		PageLoaderScript: targetFile,
	}
}
