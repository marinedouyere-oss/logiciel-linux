// Chiffrement et envoi au mini-site de Sentinelle, côté outil Windows — IDENTIQUE au lien du téléphone
// (06d_telephone.js, 06g_retour_telephone.js) : clé AES-256-GCM tirée du code de liaison par PBKDF2, paquet
// « SNT1 » + vecteur + contenu chiffré. Le code n'est jamais envoyé ; seuls le canal et le jeton (tirés du
// code) le sont. Ce fichier est indépendant de Windows (il se teste sur ce poste).
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	adresseLien   = "https://sentinelle-laisne-0ysi8zpn.netlify.app"
	selLien       = "sentinelle-laisne-industrie"
	iterationsLien = 150000
	taillePartie  = 4 * 1024 * 1024
)

var reNonCode = regexp.MustCompile(`[^A-Z0-9]`)

func normaliserCode(code string) string {
	return reNonCode.ReplaceAllString(strings.ToUpper(code), "")
}

func sha256hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// PBKDF2-HMAC-SHA256 (comme crypto.subtle.deriveKey côté page).
func pbkdf2(mdp, sel []byte, iter, taille int) []byte {
	var sortie []byte
	bloc := 1
	for len(sortie) < taille {
		mac := hmac.New(sha256.New, mdp)
		mac.Write(sel)
		mac.Write([]byte{byte(bloc >> 24), byte(bloc >> 16), byte(bloc >> 8), byte(bloc)})
		u := mac.Sum(nil)
		t := make([]byte, len(u))
		copy(t, u)
		for i := 1; i < iter; i++ {
			mac = hmac.New(sha256.New, mdp)
			mac.Write(u)
			u = mac.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		sortie = append(sortie, t...)
		bloc++
	}
	return sortie[:taille]
}

type secretsLien struct {
	canal string
	jeton string
	gcm   cipher.AEAD
}

// Canal (où déposer), jeton d'écriture et clé, tirés du code. `but` distingue les canaux (validations d'un PC).
func secrets(code, but string) (*secretsLien, error) {
	n := normaliserCode(code)
	canal := sha256hex(but + ":" + n)[:32]
	jeton := sha256hex("sentinelle-ecriture:" + n)
	cle := pbkdf2([]byte(n), []byte(selLien), iterationsLien, 32)
	bloc, err := aes.NewCipher(cle)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(bloc)
	if err != nil {
		return nil, err
	}
	return &secretsLien{canal: canal, jeton: jeton, gcm: gcm}, nil
}

// « SNT1 » + vecteur (12) + chiffré (avec l'étiquette d'authenticité GCM, comme WebCrypto).
func (s *secretsLien) chiffrer(clair []byte) ([]byte, error) {
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return nil, err
	}
	chiffre := s.gcm.Seal(nil, iv, clair, nil)
	paquet := make([]byte, 0, 16+len(chiffre))
	paquet = append(paquet, []byte("SNT1")...)
	paquet = append(paquet, iv...)
	paquet = append(paquet, chiffre...)
	return paquet, nil
}

func (s *secretsLien) dechiffrer(paquet []byte) ([]byte, error) {
	if len(paquet) < 17 || string(paquet[:4]) != "SNT1" {
		return nil, fmt.Errorf("paquet illisible")
	}
	return s.gcm.Open(nil, paquet[4:16], paquet[16:], nil)
}

func gziper(b []byte) []byte {
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	w.Write(b)
	w.Close()
	return buf.Bytes()
}

// Dépose un paquet sur le mini-site (PUT des parties + POST du manifeste), comme la page.
func deposer(s *secretsLien, paquet []byte) error {
	version := fmt.Sprintf("%s%s", base36(time.Now().UnixMilli()), hex.EncodeToString(alea(4)))
	parties := (len(paquet) + taillePartie - 1) / taillePartie
	if parties < 1 {
		parties = 1
	}
	api := adresseLien + "/api/partage?canal=" + s.canal
	for i := 0; i < parties; i++ {
		fin := (i + 1) * taillePartie
		if fin > len(paquet) {
			fin = len(paquet)
		}
		req, _ := http.NewRequest("PUT", fmt.Sprintf("%s&version=%s&partie=%d", api, version, i), bytes.NewReader(paquet[i*taillePartie:fin]))
		req.Header.Set("X-Sentinelle-Jeton", s.jeton)
		req.Header.Set("Content-Type", "application/octet-stream")
		if err := envoyer(req, nil); err != nil {
			return err
		}
	}
	corps, _ := json.Marshal(map[string]interface{}{"version": version, "parties": parties, "taille": len(paquet), "genere": time.Now().UTC().Format(time.RFC3339)})
	req, _ := http.NewRequest("POST", api, bytes.NewReader(corps))
	req.Header.Set("X-Sentinelle-Jeton", s.jeton)
	req.Header.Set("Content-Type", "application/json")
	return envoyer(req, nil)
}

// Récupère le paquet déposé sur un canal (le manifeste puis les parties). nil si rien (404).
func telecharger(s *secretsLien) ([]byte, error) {
	api := adresseLien + "/api/partage?canal=" + s.canal
	var m struct {
		Version string `json:"version"`
		Parties int    `json:"parties"`
	}
	req, _ := http.NewRequest("GET", api, nil)
	code, err := envoyerJSON(req, &m)
	if err != nil {
		return nil, err
	}
	if code == 404 {
		return nil, nil
	}
	var tout []byte
	for i := 0; i < m.Parties; i++ {
		req, _ := http.NewRequest("GET", fmt.Sprintf("%s&version=%s&partie=%d", api, m.Version, i), nil)
		var b []byte
		if err := envoyer(req, &b); err != nil {
			return nil, err
		}
		tout = append(tout, b...)
	}
	return tout, nil
}

var clientHTTP = &http.Client{Timeout: 60 * time.Second}

func envoyer(req *http.Request, dans *[]byte) error {
	r, err := clientHTTP.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	if r.StatusCode >= 300 {
		return fmt.Errorf("le site a répondu %d : %s", r.StatusCode, strings.TrimSpace(string(b)))
	}
	if dans != nil {
		*dans = b
	}
	return nil
}

func envoyerJSON(req *http.Request, dans interface{}) (int, error) {
	r, err := clientHTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	if r.StatusCode == 404 {
		return 404, nil
	}
	if r.StatusCode >= 300 {
		return r.StatusCode, fmt.Errorf("le site a répondu %d", r.StatusCode)
	}
	if dans != nil && len(b) > 0 {
		if err := json.Unmarshal(b, dans); err != nil {
			return r.StatusCode, err
		}
	}
	return r.StatusCode, nil
}

func base36(n int64) string {
	const chiffres = "0123456789abcdefghijklmnopqrstuvwxyz"
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{chiffres[n%36]}, b...)
		n /= 36
	}
	return string(b)
}

func alea(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

// Décompresse si le contenu est en gzip (comme le fait la page).
func degziperSiBesoin(b []byte) []byte {
	if len(b) < 2 || b[0] != 0x1f || b[1] != 0x8b {
		return b
	}
	r, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return b
	}
	defer r.Close()
	out, err := io.ReadAll(r)
	if err != nil {
		return b
	}
	return out
}
