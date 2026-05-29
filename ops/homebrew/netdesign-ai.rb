cask "netdesign-ai" do
  version "2.4.0"
  sha256 :no_check  # updated by CI after each release build

  url "https://github.com/Amit33-design/Network-Automation/releases/download/v#{version}/NetDesign-AI-#{version}.dmg"
  name "NetDesign AI"
  desc "AI-powered network design, config generation & automation platform"
  homepage "https://github.com/Amit33-design/Network-Automation"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  # Docker Desktop is required to run backend services
  depends_on cask: "docker" unless system "/usr/local/bin/docker", "info", out: File::NULL, err: File::NULL

  app "NetDesign AI.app"

  zap trash: [
    "~/Library/Application Support/netdesign-ai",
    "~/Library/Logs/netdesign-ai",
    "~/.netdesign",
  ]
end
