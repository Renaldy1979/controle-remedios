	// MedCuidar: aplica a versão no handshake (corrige "Client outdated (405)"); equivale ao PR #227 da Evolution Go.
	if version.Major > 0 && version.Minor > 0 && version.Patch > 0 {
		store.SetWAVersion(store.WAVersionContainer{uint32(version.Major), uint32(version.Minor), uint32(version.Patch)})
		w.loggerWrapper.GetLogger(cd.Instance.Id).LogInfo("[%s] Applied store.SetWAVersion -> %s", cd.Instance.Id, store.GetWAVersion().String())
	}

