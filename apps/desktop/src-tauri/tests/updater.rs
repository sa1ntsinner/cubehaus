// Signed updates: a release is installed only when its signature matches the
// key the app carries, it names the version announced and it is newer; and only once, when
// the timer is idle and nothing is left to write. The key here is made for the test and
// thrown away with it; no production key exists in the repository.

use cubehaus_lib::database::{Database, Statement};
use cubehaus_lib::update::{self, Downloaded, Installer, UpdateState};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri_plugin_updater::UpdaterExt;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "cubehaus-update-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for index in 0..4 {
            if index <= chunk.len() {
                out.push(TABLE[(n >> (18 - 6 * index) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A disposable key pair, in the updater's encoding (base64 of minisign's text).
struct TestKey {
    pk: minisign::PublicKey,
    sk: minisign::SecretKey,
}

impl TestKey {
    fn new() -> Self {
        let minisign::KeyPair { pk, sk } =
            minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        Self { pk, sk }
    }
    fn public(&self) -> String {
        base64(self.pk.to_box().unwrap().to_string().as_bytes())
    }
    /// Signed as the Tauri CLI signs: the version in the trusted comment.
    fn sign(&self, bytes: &[u8], version: &str) -> String {
        let comment = format!("timestamp:1795348800\tfile:cubehaus.app.tar.gz\tversion:{version}");
        let signature =
            minisign::sign(Some(&self.pk), &self.sk, bytes, Some(&comment), None).unwrap();
        base64(signature.to_string().as_bytes())
    }
}

/// Serves fixed bodies by path over plain HTTP on a free local port, one request per
/// connection, until the test ends.
fn serve(routes: HashMap<String, Vec<u8>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                continue;
            }
            let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
            loop {
                let mut header = String::new();
                if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
                    break;
                }
            }
            let (status, body) = match routes.get(&path) {
                Some(body) => ("200 OK", body.clone()),
                None => ("404 Not Found", Vec::new()),
            };
            let _ = write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(&body);
        }
    });
    format!("http://{address}")
}

fn manifest(base: &str, version: &str, platform: &str, artifact: &str, signature: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "version": version,
        "pub_date": "2026-11-22T12:00:00Z",
        "platforms": { platform: { "url": format!("{base}{artifact}"), "signature": signature } }
    }))
    .unwrap()
}

/// This machine's target in the static manifest, as the updater looks it up.
fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

/// A packaged app at 0.1.0-rc.1 whose updater trusts `pubkey` (test transport over plain
/// HTTP, which a release configuration refuses: see `configured`).
fn app(pubkey: &str) -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.package_info_mut().version = "0.1.0-rc.1".parse().unwrap();
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({
            "pubkey": pubkey,
            "endpoints": [],
            "requireSignedVersion": true,
            "dangerousInsecureTransportProtocol": true
        }),
    );
    tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap()
}

async fn fetch(
    app: &tauri::App<tauri::test::MockRuntime>,
    endpoint: &str,
    bundle: &Path,
) -> Result<Option<Downloaded>, cubehaus_lib::database::Error> {
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint.parse().unwrap()])
        .unwrap()
        .executable_path(bundle.join("Contents/MacOS/cubehaus"))
        .build()
        .unwrap();
    update::fetch(Some(&updater)).await
}

struct Counting {
    installs: Arc<AtomicUsize>,
    to: PathBuf,
}

impl Installer for Counting {
    fn install(&self, bytes: &[u8]) -> Result<(), cubehaus_lib::database::Error> {
        self.installs.fetch_add(1, Ordering::SeqCst);
        std::fs::write(&self.to, bytes)
            .map_err(|error| cubehaus_lib::database::Error(error.to_string()))
    }
}

fn statement(sql: &str, params: Vec<Value>) -> Statement {
    Statement {
        sql: sql.into(),
        params,
    }
}

#[test]
fn update_rejects_tamper_and_waits_for_idle() {
    let key = TestKey::new();
    let other = TestKey::new();
    let package = b"cubehaus 0.1.0-rc.2 package bytes".repeat(64);
    let mut tampered = package.clone();
    tampered[100] ^= 1;
    let good = key.sign(&package, "0.1.0-rc.2");

    // The packages on one server; the manifests, which need its address, on another.
    let mut packages = HashMap::new();
    packages.insert("/package.tar.gz".to_string(), package.clone());
    packages.insert("/tampered.tar.gz".to_string(), tampered);
    let base = serve(packages);
    let p = platform();
    let mut manifests = HashMap::new();
    manifests.insert(
        "/good.json".to_string(),
        manifest(&base, "0.1.0-rc.2", &p, "/package.tar.gz", &good),
    );
    manifests.insert(
        "/tampered.json".to_string(),
        manifest(&base, "0.1.0-rc.2", &p, "/tampered.tar.gz", &good),
    );
    manifests.insert(
        "/wrong-key.json".to_string(),
        manifest(
            &base,
            "0.1.0-rc.2",
            &p,
            "/package.tar.gz",
            &other.sign(&package, "0.1.0-rc.2"),
        ),
    );
    manifests.insert(
        "/wrong-target.json".to_string(),
        manifest(
            &base,
            "0.1.0-rc.2",
            "windows-x86_64",
            "/package.tar.gz",
            &good,
        ),
    );
    manifests.insert(
        "/older.json".to_string(),
        manifest(
            &base,
            "0.1.0-rc.0",
            &p,
            "/package.tar.gz",
            &key.sign(&package, "0.1.0-rc.0"),
        ),
    );
    // A newer version number paired with a package signed for another version.
    manifests.insert(
        "/relabelled.json".to_string(),
        manifest(&base, "0.1.0-rc.3", &p, "/package.tar.gz", &good),
    );
    let index = serve(manifests);

    let app = app(&key.public());
    let bundle = temp_dir("bundle").join("cubehaus.app");
    let installs = Arc::new(AtomicUsize::new(0));
    let data = temp_dir("data");
    let backups = temp_dir("backups");
    let slot = Mutex::new(Some(Arc::new(Database::open(&data).unwrap())));
    {
        let db = slot.lock().unwrap().clone().unwrap();
        db.batch(vec![
            statement(
                "CREATE TABLE solve (id TEXT PRIMARY KEY, time_ms INTEGER NOT NULL) STRICT; \
                 PRAGMA user_version = 6",
                vec![],
            ),
            statement(
                "INSERT INTO solve (id, time_ms) VALUES ('b', 12345)",
                vec![],
            ),
        ])
        .unwrap();
    }
    let counted = |downloaded: Downloaded| Downloaded {
        installer: Box::new(Counting {
            installs: installs.clone(),
            to: bundle.with_extension("installed"),
        }),
        ..downloaded
    };

    tauri::async_runtime::block_on(async {
        // One changed byte, another key, another target, an older version, a relabelled
        // version: nothing is downloaded, so nothing can be installed.
        for (name, refusal) in [
            ("tampered", Some("signature verification failed")),
            ("wrong-key", Some("different key")),
            ("wrong-target", Some("platforms")),
            ("relabelled", Some("signed for version 0.1.0-rc.2")),
            ("older", None),
        ] {
            match fetch(&app, &format!("{index}/{name}.json"), &bundle).await {
                Ok(None) => assert!(refusal.is_none(), "{name}: expected a refusal"),
                Ok(Some(_)) => panic!("{name}: accepted"),
                Err(error) => {
                    let expected = refusal.unwrap_or("no error");
                    assert!(error.0.contains(expected), "{name}: {error}");
                }
            }
            let pending = Mutex::new(None);
            assert_eq!(
                update::apply_when_idle(true, &pending, &slot, &data, &backups, 1).unwrap(),
                UpdateState::Current
            );
        }
        assert_eq!(installs.load(Ordering::SeqCst), 0);

        // The valid update downloads while the timer runs and waits.
        let downloaded = fetch(&app, &format!("{index}/good.json"), &bundle)
            .await
            .unwrap()
            .expect("the signed newer release");
        assert_eq!(downloaded.version, "0.1.0-rc.2");
        assert_eq!(downloaded.bytes, package);
        let pending = Mutex::new(Some(counted(downloaded)));
        let now = 1_795_348_800_000;
        assert_eq!(
            update::apply_when_idle(false, &pending, &slot, &data, &backups, now).unwrap(),
            UpdateState::Waiting
        );
        // Idle on the page, but a write is still in flight natively: it waits too.
        let in_flight = slot.lock().unwrap().clone();
        assert_eq!(
            update::apply_when_idle(true, &pending, &slot, &data, &backups, now).unwrap(),
            UpdateState::Waiting
        );
        assert!(slot.lock().unwrap().is_some(), "the database stays in use");
        drop(in_flight);
        assert_eq!(installs.load(Ordering::SeqCst), 0);
        assert!(cubehaus_lib::backup::list(&backups).unwrap().is_empty());

        // Stopped, saved: backed up, then installed exactly once.
        assert_eq!(
            update::apply_when_idle(true, &pending, &slot, &data, &backups, now).unwrap(),
            UpdateState::Applied
        );
        assert_eq!(
            update::apply_when_idle(true, &pending, &slot, &data, &backups, now).unwrap(),
            UpdateState::Current
        );
        assert_eq!(installs.load(Ordering::SeqCst), 1);
        assert_eq!(
            std::fs::read(bundle.with_extension("installed")).unwrap(),
            package
        );
        assert_eq!(cubehaus_lib::backup::list(&backups).unwrap().len(), 1);
    });

    // The relaunched app finds the solve.
    let reopened = Database::open(&data).unwrap();
    let rows = reopened
        .all("SELECT id, time_ms FROM solve", vec![])
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], json!("b"));
    assert_eq!(rows[0]["time_ms"], json!(12345));
}

/// The repository's own configuration: the owner's public key and the GitHub address of the
/// latest release's manifest, which `configured` accepts.
#[test]
fn the_app_carries_the_release_key_and_address() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let ours = config
        .get("plugins")
        .and_then(|plugins| plugins.get("updater"))
        .expect("an updater section");
    assert_eq!(
        ours["endpoints"],
        json!(["https://github.com/sa1ntsinner/cubehaus/releases/latest/download/latest.json"])
    );
    // The key as `tauri signer generate` writes it: base64 of minisign's public key file.
    let pubkey = ours["pubkey"].as_str().unwrap();
    let text = String::from_utf8(decode_base64(pubkey)).unwrap();
    let mut lines = text.lines();
    assert!(
        lines
            .next()
            .unwrap()
            .starts_with("untrusted comment: minisign public key")
    );
    minisign::PublicKey::from_base64(lines.next().unwrap()).expect("a minisign public key");
    // The version a release announces must be the one its signature names.
    assert_eq!(ours["requireSignedVersion"], json!(true));
    assert!(update::configured(Some(ours)).is_some());
}

fn decode_base64(text: &str) -> Vec<u8> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0);
    for byte in text.bytes().filter(|b| *b != b'=') {
        let value = TABLE.iter().position(|t| *t == byte).unwrap() as u32;
        acc = (acc << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    out
}

/// No release yet (the address answers 404), no network, or a page where the manifest should
/// be: no update and no error, so the page shows nothing; the next check tries again.
#[test]
fn an_unreachable_release_is_quiet() {
    let key = TestKey::new();
    let app = app(&key.public());
    let bundle = temp_dir("quiet").join("cubehaus.app");
    let mut routes = HashMap::new();
    routes.insert("/page.json".to_string(), b"<html>Sign in</html>".to_vec());
    let index = serve(routes);
    // A port nobody listens on: bound, then let go.
    let closed = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}", listener.local_addr().unwrap())
    };
    tauri::async_runtime::block_on(async {
        for endpoint in [
            format!("{index}/latest.json"),
            format!("{index}/page.json"),
            format!("{closed}/latest.json"),
        ] {
            match fetch(&app, &endpoint, &bundle).await {
                Ok(None) => {}
                Ok(Some(_)) => panic!("{endpoint}: an update"),
                Err(error) => panic!("{endpoint}: {error}"),
            }
        }
    });

    // A manifest whose package is missing (a release half uploaded) is quiet too.
    let p = platform();
    let mut manifests = HashMap::new();
    manifests.insert(
        "/half.json".to_string(),
        manifest(
            &index,
            "0.1.0-rc.2",
            &p,
            "/gone.tar.gz",
            &key.sign(b"x", "0.1.0-rc.2"),
        ),
    );
    let half = serve(manifests);
    tauri::async_runtime::block_on(async {
        assert!(
            fetch(&app, &format!("{half}/half.json"), &bundle)
                .await
                .unwrap()
                .is_none()
        );
    });
}

#[test]
fn updater_stays_off_without_a_configured_key() {
    for refused in [
        json!({ "pubkey": "", "endpoints": ["https://example.invalid/latest.json"] }),
        json!({ "pubkey": "a2V5", "endpoints": [] }),
        json!({ "pubkey": "a2V5", "endpoints": ["http://example.invalid/latest.json"] }),
        json!({ "pubkey": "a2V5", "endpoints": ["https://example.invalid/latest.json"], "dangerousInsecureTransportProtocol": true }),
        json!({ "endpoints": ["https://example.invalid/latest.json"] }),
    ] {
        assert!(update::configured(Some(&refused)).is_none(), "{refused}");
    }
    assert!(
        update::configured(Some(
            &json!({ "pubkey": "a2V5", "endpoints": ["https://example.invalid/latest.json"] })
        ))
        .is_some()
    );

    // Off means no request at all: with no updater nothing is fetched. A listener that
    // counts connections stays at zero.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let fetched = tauri::async_runtime::block_on(update::fetch(None)).unwrap();
    assert!(fetched.is_none());
    assert!(listener.accept().is_err(), "nothing connected");
}

/// Accepts connections and never answers: a network that swallows requests (a captive
/// portal, a dropped route). Nothing is sent back until the test ends.
fn black_hole() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        let mut held = Vec::new();
        for stream in listener.incoming().flatten() {
            held.push(stream);
        }
    });
    format!("http://{address}")
}

/// Offline in the worst way, a request that is never answered: the check gives up after
/// its time limit and is quiet, as with no network at all. Without a limit it would wait
/// for ever, and every later check (one an hour) would pile up behind it.
#[test]
fn a_check_that_gets_no_answer_gives_up_quietly() {
    let key = TestKey::new();
    let app = app(&key.public());
    let bundle = temp_dir("silent").join("cubehaus.app");
    let endpoint = format!("{}/latest.json", black_hole());

    // The plugin's own default has no limit: after three seconds it is still waiting.
    let unbounded = app
        .updater_builder()
        .endpoints(vec![endpoint.parse().unwrap()])
        .unwrap()
        .executable_path(bundle.join("Contents/MacOS/cubehaus"))
        .build()
        .unwrap();
    let (sent, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sent.send(tauri::async_runtime::block_on(unbounded.check()).is_ok());
    });
    assert!(
        received
            .recv_timeout(std::time::Duration::from_secs(3))
            .is_err(),
        "the unbounded check answered"
    );

    // The app's updater is bounded.
    assert!(update::CHECK_TIMEOUT <= std::time::Duration::from_secs(60));
    let bounded = update::bounded(app.updater_builder(), std::time::Duration::from_secs(1))
        .endpoints(vec![endpoint.parse().unwrap()])
        .unwrap()
        .executable_path(bundle.join("Contents/MacOS/cubehaus"))
        .build()
        .unwrap();
    let started = std::time::Instant::now();
    let fetched = tauri::async_runtime::block_on(update::fetch(Some(&bounded)));
    assert!(matches!(fetched, Ok(None)), "quiet, no update");
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
}
