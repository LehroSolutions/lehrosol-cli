class Lehrosol < Formula
  desc "Unified agentic engineering console"
  homepage "https://github.com/lehrosolutions/lehrosol-cli"
  url "https://example.com/lehrosol-cli-2.0.0.tgz"
  version "2.0.0"
  sha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  license "GPL-3.0-or-later"
  depends_on "node@20"
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/lehrosol.js" => "lehrosol"
  end
  test do
    assert_match version.to_s, shell_output("#{bin}/lehrosol --version")
  end
end
